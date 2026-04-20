import {
    ApplicationCommandInputType,
    ApplicationCommandOptionType,
    findOption
} from "@api/Commands";
import { definePluginSettings } from "@api/Settings";
import {
    ChatBarButton,
    ChatBarButtonFactory,
    addChatBarButton,
    removeChatBarButton
} from "@api/ChatButtons";
import definePlugin, { OptionType } from "@utils/types";
import { Devs } from "@utils/constants";
import { findByPropsLazy } from "@webpack";
import { Button, Forms, Text, React } from "@webpack/common";
import {
    ModalRoot,
    ModalHeader,
    ModalContent,
    ModalFooter,
    ModalCloseButton,
    ModalSize,
    ModalProps,
    openModal
} from "@utils/modal";

const typing = findByPropsLazy("startTyping");

// إعدادات البلوقن
const settings = definePluginSettings({
    maxSeconds: {
        type: OptionType.NUMBER,
        description: "الحد الأقصى لمدة الكتابة (بالثواني)",
        default: 600,
        minimum: 5,
        maximum: 6000
    },
    mode: {
        type: OptionType.STRING,
        description: "نمط الكتابة",
        default: "continuous",
        options: [
            { label: "Continuous", value: "continuous" },
            { label: "Pulses", value: "pulses" }
        ]
    }
});

type Mode = "continuous" | "pulses";

// حالة التشغيل الحالية لكل قناة
const activeTypers = new Map<string, { stopped: boolean }>();

async function typeForever(seconds: number, ctx: any) {
    const channelId = ctx.channel.id as string;
    const state = { stopped: false };
    activeTypers.set(channelId, state);

    const mode = (settings.store.mode as Mode) || "continuous";

    try {
        const stepMs = mode === "continuous" ? 5000 : 3000;
        const totalMs = seconds * 1000;
        const start = Date.now();

        while (!state.stopped && Date.now() - start < totalMs) {
            typing.startTyping(channelId);
            await new Promise(resolve => setTimeout(resolve, stepMs));

            if (mode === "pulses") {
                typing.stopTyping(channelId);
                await new Promise(resolve => setTimeout(resolve, 1500));
            }
        }
    } finally {
        typing.stopTyping(channelId);
        activeTypers.delete(channelId);
    }
}

function stopTypingForChannel(channelId: string) {
    const state = activeTypers.get(channelId);
    if (state) state.stopped = true;
    typing.stopTyping(channelId);
    activeTypers.delete(channelId);
}

// مودال إعدادات
function SettingsModal(props: ModalProps) {
    const { transitionState, onClose } = props;
    const [max, setMax] = React.useState<number>(settings.store.maxSeconds);
    const [mode, setMode] = React.useState<Mode>((settings.store.mode as Mode) || "continuous");

    const save = () => {
        settings.store.maxSeconds = max;
        settings.store.mode = mode;
        onClose();
    };

    return (
        <ModalRoot transitionState={transitionState} size={ModalSize.SMALL}>
            <ModalHeader>
                <Text variant="heading-md/semibold">TypeForever Settings</Text>
                <ModalCloseButton onClick={onClose} />
            </ModalHeader>
            <ModalContent>
                <Forms.FormSection>
                    <Forms.FormTitle>Maximum seconds</Forms.FormTitle>
                    <Forms.FormText>الحد الأقصى للوقت الذي يسمح به الأمر.</Forms.FormText>
                    <Forms.FormDivider />
                    <Forms.FormSection>
                        <Forms.FormTitle>{max} seconds</Forms.FormTitle>
                        <Forms.FormText>بين 5 و 6000 ثانية.</Forms.FormText>
                        <Forms.FormDivider />
                        <Forms.FormSection>
                            <input
                                type="number"
                                min={5}
                                max={6000}
                                value={max}
                                onChange={e => setMax(Number(e.target.value) || 0)}
                                style={{ width: "100%", padding: 8, borderRadius: 4 }}
                            />
                        </Forms.FormSection>
                    </Forms.FormSection>

                    <Forms.FormDivider />

                    <Forms.FormSection>
                        <Forms.FormTitle>Mode</Forms.FormTitle>
                        <Forms.FormText>
                            Continuous = كتابة مستمرة، Pulses = نبضات كتابة.
                        </Forms.FormText>
                        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                            <Button
                                size={Button.Sizes.SMALL}
                                color={mode === "continuous" ? Button.Colors.BRAND : Button.Colors.SECONDARY}
                                onClick={() => setMode("continuous")}
                            >
                                Continuous
                            </Button>
                            <Button
                                size={Button.Sizes.SMALL}
                                color={mode === "pulses" ? Button.Colors.BRAND : Button.Colors.SECONDARY}
                                onClick={() => setMode("pulses")}
                            >
                                Pulses
                            </Button>
                        </div>
                    </Forms.FormSection>
                </Forms.FormSection>
            </ModalContent>
            <ModalFooter>
                <Button color={Button.Colors.SECONDARY} onClick={onClose}>
                    Cancel
                </Button>
                <Button color={Button.Colors.BRAND} onClick={save}>
                    Save
                </Button>
            </ModalFooter>
        </ModalRoot>
    );
}

// -------- Chat Bar Button (يشغل كتابة 30 ثانية) --------

const TypeForeverChatButton: ChatBarButtonFactory = ({ channel, isMainChat }) => {
    if (!isMainChat) return null;

    const handleClick = () => {
        console.log("[rzforever] button clicked in", channel.id);
        // نشغّل كتابة لمدة 30 ثانية بدون إرسال رسالة
        typeForever(30, { channel: { id: channel.id } }).catch(console.error);
    };

    return (
        <ChatBarButton
            tooltip="Start TypeForever (30s)"
            onClick={handleClick}
            buttonProps={{ "aria-label": "TypeForever" }}
        >
            TF
        </ChatBarButton>
    );
};

export default definePlugin({
    name: "TypeForever!",
    description: "Type for any amount of time with a slash command",
    authors: [Devs.rz30], // عدّل الكي إذا اسمك مختلف
    dependencies: ["CommandsAPI", "ChatButtonsAPI"],
    settings,

    getSettingsPanel() {
        return (
            <Button
                color={Button.Colors.BRAND}
                onClick={() => openModal(mProps => <SettingsModal {...mProps} />)}
            >
                Open TypeForever settings
            </Button>
        );
    },

    start() {
        addChatBarButton("rzforever-type", TypeForeverChatButton);
    },

    stop() {
        removeChatBarButton("rzforever-type");
    },

    commands: [
        {
            name: "TypeForever",
            description: "Start typing for a duration",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "seconds",
                    description: "Number of seconds to type for",
                    type: ApplicationCommandOptionType.INTEGER,
                    required: true
                }
            ],
            execute: async (args, ctx) => {
                const count = findOption(args, "seconds", "");
                const seconds = Number(count);
                const max = Number(settings.store.maxSeconds) || 600;

                if (!Number.isFinite(seconds) || seconds <= 0 || seconds > max) {
                    await ctx.reply?.({
                        content: `الرقم لازم يكون بين 1 و ${max}.`,
                        flags: 1 << 6
                    });
                    return;
                }

                stopTypingForChannel(ctx.channel.id);

                await ctx.reply?.({
                    content: `رح أكتب لمدة ${seconds} ثانية (${settings.store.mode}).`,
                    flags: 1 << 6
                });

                typeForever(seconds, ctx).catch(console.error);
            }
        },
        {
            name: "StopTyping",
            description: "Stop the current typing loop",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [],
            execute: async (_args, ctx) => {
                stopTypingForChannel(ctx.channel.id);
                await ctx.reply?.({
                    content: "تم إيقاف الكتابة.",
                    flags: 1 << 6
                });
            }
        }
    ],

    // لو المستخدم كتب رسالة بنفسه، نوقف الكتابة
    onMessageCreate(message) {
        if (
            !message?.author?.id ||
            message.author.id === window.DiscordNative?.crashReporter?.getMetadata?.().user_id
        ) {
            return;
        }
        stopTypingForChannel(message.channel_id);
    }
});
