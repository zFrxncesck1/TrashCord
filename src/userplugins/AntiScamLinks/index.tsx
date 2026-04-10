import { openModal, ModalRoot, ModalHeader, ModalContent, ModalFooter, ModalCloseButton } from "@utils/modal";
import definePlugin from "@utils/types";
import { Forms, Button, React } from "@webpack/common";

const SCAM_LIST_URL = "https://raw.githubusercontent.com/Discord-AntiScam/scam-links/refs/heads/main/list.txt";
const UPDATE_INTERVAL = 43_200_000;

let scamDomains: Set<string> = new Set();
let intervalId: ReturnType<typeof setInterval> | null = null;

async function fetchScamList(): Promise<void> {
    try {
        const res = await fetch(SCAM_LIST_URL);
        if (!res.ok) return;
        const text = await res.text();
        scamDomains = new Set(
            text.split("\n")
                .map(d => d.trim().toLowerCase())
                .filter(Boolean)
        );
    } catch {}
}

function isScamUrl(href: string): boolean {
    try {
        const host = new URL(href).hostname.toLowerCase().replace(/^www\./, "");
        return scamDomains.has(host);
    } catch {
        return false;
    }
}

function ScamWarningModal({ url, onConfirm, onCancel, modalProps }: {
    url: string;
    onConfirm: () => void;
    onCancel: () => void;
    modalProps: any;
}) {
    return (
        <ModalRoot {...modalProps} size="small">
            <ModalHeader>
                <Forms.FormTitle tag="h2" style={{ color: "#ed4245", margin: 0 }}>
                    ⚠️ Scam Link Detected
                </Forms.FormTitle>
                <ModalCloseButton onClick={onCancel} />
            </ModalHeader>
            <ModalContent style={{ padding: "16px" }}>
                <Forms.FormText style={{ marginBottom: 8 }}>
                    This link is flagged as a <strong>scam or phishing site</strong>.
                </Forms.FormText>
                <Forms.FormText
                    style={{
                        wordBreak: "break-all",
                        background: "var(--background-secondary)",
                        padding: "8px",
                        borderRadius: 4,
                        color: "#ed4245",
                        marginBottom: 8,
                        fontFamily: "monospace",
                        fontSize: 13
                    }}
                >
                    {url}
                </Forms.FormText>
                <Forms.FormText>
                    Opening this site may compromise your account or steal your information.
                    Do you still want to proceed?
                </Forms.FormText>
            </ModalContent>
            <ModalFooter style={{ gap: 8 }}>
                <Button color={Button.Colors.PRIMARY} onClick={onCancel}>
                    Go Back (Safe)
                </Button>
                <Button color={Button.Colors.RED} onClick={onConfirm}>
                    Open Anyway
                </Button>
            </ModalFooter>
        </ModalRoot>
    );
}

function handleLinkClick(e: MouseEvent): void {
    const anchor = (e.target as Element).closest("a");
    if (!anchor) return;

    const href = (anchor as HTMLAnchorElement).href;
    if (!href || !isScamUrl(href)) return;

    e.preventDefault();
    e.stopImmediatePropagation();

    openModal(props =>
        React.createElement(ScamWarningModal, {
            url: href,
            onConfirm: () => {
                props.onClose();
                window.open(href, "_blank", "noopener,noreferrer");
            },
            onCancel: props.onClose,
            modalProps: props
        })
    );
}

export default definePlugin({
    name: "AntiScamLinks",
    description: "Warns you before opening scam or phishing links detected in Discord messages.",
    authors: [
        { name: "Irritably", id: 928787166916640838n },
        { name: "zFrxncesck1", id: 456195985404592149n },
    ],

    async start() {
        await fetchScamList();
        intervalId = setInterval(fetchScamList, UPDATE_INTERVAL);
        document.addEventListener("click", handleLinkClick, true);
    },

    stop() {
        if (intervalId !== null) {
            clearInterval(intervalId);
            intervalId = null;
        }
        document.removeEventListener("click", handleLinkClick, true);
        scamDomains.clear();
    }
});
