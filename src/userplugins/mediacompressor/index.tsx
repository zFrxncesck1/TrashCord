import { addMessagePreSendListener, MessageSendListener, removeMessagePreSendListener } from "@api/MessageEvents";
import definePlugin from "@utils/types";
import { SelectedChannelStore } from "@webpack/common";

import { UploadButton, UploadStatus } from "./components";
import {
    allStates,
    applyCompressedFile,
    applyOriginalFile,
    cancelCompression,
    clearCompressionResult,
    emitState,
    getFailedStates,
    getPendingStates,
    getUploadsForChannel,
    maybeShowBlockedSendToast,
    prepareUploadsForDiscord,
    queueCompression,
    splitPromptToUploadFiles,
    syncUploadsForSend,
    uploadStates,
} from "./compression";
import { settings } from "./settings";
import type { ManagedUpload } from "./types";
import { debug, getOriginalFileSize } from "./utils";

let preSendListener: MessageSendListener | undefined;

export default definePlugin({
    name: "MediaCompressor",
    description: "Easily compress large video files directly in Discord, bypassing upload limits before sending.",
    authors: [{ name: "StraiF", id: 314034398280286208n }],
    tags: ["Media", "Utility"],
    enabledByDefault: false,
    settings,

    patches: [
        {
            find: "async uploadFiles(",
            replacement: {
                match: /async uploadFiles\((\i)\){/,
                replace: "$&$self.prepareUploadsForDiscord($1);"
            }
        },
        {
            find: "Unexpected mismatch between files and file metadata",
            replacement: {
                match: /if\(await Promise\.resolve\(\),\(0,f\.fJ\)\(v,x\)\)return void I\(t,v\);/,
                replace: "if(await Promise.resolve(),(0,f.fJ)(v,x)){let e=$self.splitPromptToUploadFiles(v);if(e.blocked.length&&e.allowed.length<1)return void I(t,e.blocked);e.blocked.length&&I(t,e.blocked);v=e.allowed;j=v.map(e=>({originalContentType:e.type,preCompressionSize:$self.getOriginalFileSize(e)}));if(v.length<1)return;}"
            }
        },
        {
            find: "handleEditModal:b,keyboardModeEnabled:_",
            replacement: {
                match: /actions:\(0,r\.jsxs\)\(i\.Fragment,\{children:\[/,
                replace: "$&m&&!N?(0,r.jsx)($self.renderUploadButton,{upload:s}):null,"
            }
        },
        {
            find: "handleEditModal:b,keyboardModeEnabled:_",
            replacement: {
                match: /children:\[\(0,r\.jsx\)\(O,\{upload:s,size:h\}\),/,
                replace: "$&!N?(0,r.jsx)($self.renderUploadStatus,{upload:s}):null,"
            }
        }
    ],

    start() {
        debug("mediaCompressor started");

        preSendListener = addMessagePreSendListener(async (channelId, _messageObj, options) => {
            const uploads = (options.uploads as ManagedUpload[] | undefined) ?? getUploadsForChannel(channelId);
            if (!uploads.length) return;

            const idleEnabledUploads = uploads.filter(upload => {
                const state = uploadStates.get(upload);
                return Boolean(state?.enabled && !state.compressedFile && state.status === "idle");
            });

            if (idleEnabledUploads.length) {
                for (const upload of idleEnabledUploads) {
                    queueCompression(upload);
                }
                maybeShowBlockedSendToast("Compression is starting. Try sending again once the progress bar finishes.");
                return { cancel: true };
            }

            const pendingStates = getPendingStates(uploads);
            if (pendingStates.length) {
                maybeShowBlockedSendToast("Wait for video compression to finish before sending.");
                return { cancel: true };
            }

            const failedStates = getFailedStates(uploads);
            if (failedStates.length) {
                maybeShowBlockedSendToast("One or more videos failed to compress. Disable compression for them or remove them before sending.");
                return { cancel: true };
            }

            for (const upload of uploads) {
                const state = uploadStates.get(upload);
                if (!state) continue;

                if (state.enabled && state.compressedFile) {
                    applyCompressedFile(state);
                } else {
                    applyOriginalFile(state);
                }
            }

            if (options.uploads) {
                syncUploadsForSend(options.uploads as ManagedUpload[]);
            }
        });
    },

    stop() {
        if (preSendListener) {
            removeMessagePreSendListener(preSendListener);
            preSendListener = undefined;
        }

        for (const state of allStates) {
            void cancelCompression(state);
            applyOriginalFile(state);
            clearCompressionResult(state);
            emitState(state);
        }
    },

    prepareUploadsForDiscord,
    splitPromptToUploadFiles,
    getOriginalFileSize,
    renderUploadButton: UploadButton,
    renderUploadStatus: UploadStatus,

    getCurrentDraftUploads() {
        const channelId = SelectedChannelStore.getChannelId();
        return channelId ? getUploadsForChannel(channelId) : [];
    },
});
