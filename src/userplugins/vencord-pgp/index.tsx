/*
 * Vencord PGP - End-to-end encryption for Discord - Fixxed by zFrxncesck1
 * https://github.com/17z7h0m4s/vencord-pgp
 *
 * Inspired by gnupg-discord (https://github.com/ibnaleem/gnupg-discord)
 * Uses OpenPGP.js (https://openpgpjs.org/)
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import { Margins } from "@utils/margins";
import { ModalCloseButton, ModalContent, ModalHeader, ModalRoot, ModalSize, openModal } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import { Button, Forms, React, Select, TabBar, Text, TextArea, TextInput, Toasts, UserStore } from "@webpack/common";

const logger = new Logger("PGP");

// React hooks - accessed via React object to avoid load-time issues
const useState = (init: any) => React.useState(init);
const useEffect = (fn: any, deps?: any) => React.useEffect(fn, deps);
const useCallback = (fn: any, deps: any) => React.useCallback(fn, deps);

// ============================================================================
// OPENPGP LOADER - Load from CDN
// ============================================================================

let openpgp: any = null;
let openpgpLoaded = false;
let openpgpLoadPromise: Promise<void> | null = null;

async function loadOpenPGP(): Promise<void> {
    if (openpgpLoaded) return;
    if (openpgpLoadPromise) return openpgpLoadPromise;

    openpgpLoadPromise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://unpkg.com/openpgp@5.11.0/dist/openpgp.min.js";
        script.onload = () => {
            openpgp = (window as any).openpgp;
            openpgpLoaded = true;
            logger.info("OpenPGP.js loaded from CDN");
            resolve();
        };
        script.onerror = () => {
            reject(new Error("Failed to load OpenPGP.js from CDN"));
        };
        document.head.appendChild(script);
    });

    return openpgpLoadPromise;
}

function requireOpenPGP() {
    if (!openpgpLoaded || !openpgp) {
        throw new Error("OpenPGP.js not loaded yet. Please wait a moment and try again.");
    }
    return openpgp;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const PGP_BLOCK_REGEX = /-----BEGIN PGP MESSAGE-----[\s\S]*?-----END PGP MESSAGE-----/g;

export const KEYSERVERS = {
    OPENPGP: "https://keys.openpgp.org",
    UBUNTU: "https://keyserver.ubuntu.com",
    MIT: "https://pgp.mit.edu",
} as const;

export type KeyserverName = keyof typeof KEYSERVERS;

// ============================================================================
// SETTINGS
// ============================================================================

export const settings = definePluginSettings({
    privateKey: {
        type: OptionType.STRING,
        description: "Your PGP private key (armored format)",
        default: "",
        hidden: true,
    },
    publicKey: {
        type: OptionType.STRING,
        description: "Your PGP public key (armored format)",
        default: "",
        hidden: true,
    },
    passphrase: {
        type: OptionType.STRING,
        description: "Passphrase for your private key",
        default: "",
        hidden: true,
    },
    knownPublicKeys: {
        type: OptionType.STRING,
        description: "JSON map of user IDs to their public keys",
        default: "{}",
        hidden: true,
    },
    signMessages: {
        type: OptionType.BOOLEAN,
        description: "Sign encrypted messages with your private key",
        default: true,
    },
    encryptionIndicator: {
        type: OptionType.STRING,
        description: "Prefix for encrypted messages (visual indicator)",
        default: "🔒",
    },
});

// ============================================================================
// KEY MANAGER
// ============================================================================

interface StoredKey {
    publicKey: string;
    fingerprint: string;
    userIDs: string[];
    addedAt: number;
    verified: boolean;
}

class KeyManager {
    private keyCache: Map<string, StoredKey> = new Map();

    constructor() {
        this.loadKeys();
    }

    private loadKeys(): void {
        try {
            const stored = JSON.parse(settings.store.knownPublicKeys || "{}");
            this.keyCache = new Map(Object.entries(stored));
            logger.info(`Loaded ${this.keyCache.size} known public keys`);
        } catch (err) {
            logger.error("Failed to load keys:", err);
            this.keyCache = new Map();
        }
    }

    private saveKeys(): void {
        const obj = Object.fromEntries(this.keyCache);
        settings.store.knownPublicKeys = JSON.stringify(obj);
    }

    async importPublicKeyForUser(userId: string, armoredKey: string): Promise<StoredKey> {
        const pgp = requireOpenPGP();
        const key = await pgp.readKey({ armoredKey });
        const storedKey: StoredKey = {
            publicKey: armoredKey,
            fingerprint: key.getFingerprint().toUpperCase(),
            userIDs: key.getUserIDs(),
            addedAt: Date.now(),
            verified: false,
        };
        this.keyCache.set(userId, storedKey);
        this.saveKeys();
        logger.info(`Imported public key for user ${userId}`);
        return storedKey;
    }

    getPublicKeyForUser(userId: string): string | null {
        return this.keyCache.get(userId)?.publicKey || null;
    }

    getAllKeysWithUsers(): Array<{ userId: string; key: StoredKey }> {
        return Array.from(this.keyCache.entries()).map(([userId, key]) => ({ userId, key }));
    }

    getAllPublicKeys(): string[] {
        return Array.from(this.keyCache.values()).map(k => k.publicKey);
    }

    removeKeyForUser(userId: string): boolean {
        const had = this.keyCache.delete(userId);
        if (had) this.saveKeys();
        return had;
    }

    verifyKey(userId: string): boolean {
        const stored = this.keyCache.get(userId);
        if (!stored) return false;
        stored.verified = true;
        this.saveKeys();
        return true;
    }
}

// ============================================================================
// PGP ENGINE
// ============================================================================

class PGPEngine {
    private keyManager: KeyManager;
    private cachedPrivateKey: any = null;
    private cachedPublicKey: any = null;

    constructor(keyMgr: KeyManager) {
        this.keyManager = keyMgr;
    }

    async initialize(): Promise<void> {
        await loadOpenPGP();
        await this.loadKeyPair();
    }

    private async loadKeyPair(): Promise<void> {
        const pgp = requireOpenPGP();
        const privateKeyArmored = settings.store.privateKey;
        const publicKeyArmored = settings.store.publicKey;
        const passphrase = settings.store.passphrase;

        if (!privateKeyArmored || !publicKeyArmored) {
            this.cachedPrivateKey = null;
            this.cachedPublicKey = null;
            return;
        }

        try {
            const privateKey = await pgp.readPrivateKey({ armoredKey: privateKeyArmored });
            this.cachedPrivateKey = privateKey.isDecrypted()
                ? privateKey
                : await pgp.decryptKey({ privateKey, passphrase });
            this.cachedPublicKey = await pgp.readKey({ armoredKey: publicKeyArmored });
            logger.info("Key pair loaded");
        } catch (err) {
            logger.error("Failed to load key pair:", err);
        }
    }

    async generateKeyPair(name: string, email: string, passphrase: string, type: "ecc" | "rsa" = "ecc"): Promise<{ publicKey: string; privateKey: string }> {
        const pgp = requireOpenPGP();

        const keyOptions: any = {
            type,
            userIDs: [{ name, email }],
            passphrase,
            format: "armored",
        };

        if (type === "ecc") {
            keyOptions.curve = "curve25519";
        } else {
            keyOptions.rsaBits = 4096;
        }

        const { privateKey, publicKey } = await pgp.generateKey(keyOptions);
        settings.store.privateKey = privateKey;
        settings.store.publicKey = publicKey;
        settings.store.passphrase = passphrase;
        await this.loadKeyPair();
        return { publicKey, privateKey };
    }

    async importPrivateKey(armoredKey: string, passphrase: string): Promise<void> {
        const pgp = requireOpenPGP();
        const privateKey = await pgp.readPrivateKey({ armoredKey });
        if (!privateKey.isDecrypted()) {
            await pgp.decryptKey({ privateKey, passphrase });
        }
        const publicKey = privateKey.toPublic().armor();
        settings.store.privateKey = armoredKey;
        settings.store.publicKey = publicKey;
        settings.store.passphrase = passphrase;
        await this.loadKeyPair();
    }

    async encrypt(plaintext: string, recipientPublicKey: string, sign: boolean = true): Promise<string> {
        const pgp = requireOpenPGP();
        const encryptionKeys = await pgp.readKey({ armoredKey: recipientPublicKey });

        const options: any = {
            message: await pgp.createMessage({ text: plaintext }),
            encryptionKeys: this.cachedPublicKey ? [encryptionKeys, this.cachedPublicKey] : encryptionKeys,
            format: "armored"
        };

        if (sign && this.cachedPrivateKey) {
            options.signingKeys = this.cachedPrivateKey;
        }

        return await pgp.encrypt(options);
    }

    async decrypt(armoredMessage: string): Promise<{ decrypted: string; verified: boolean }> {
        const pgp = requireOpenPGP();
        if (!this.cachedPrivateKey) {
            throw new Error("No private key configured");
        }

        const message = await pgp.readMessage({ armoredMessage });
        const options: any = {
            message,
            decryptionKeys: this.cachedPrivateKey
        };

        // Add verification keys
        const verificationKeys: any[] = [];
        if (this.cachedPublicKey) verificationKeys.push(this.cachedPublicKey);
        for (const key of this.keyManager.getAllPublicKeys()) {
            try {
                verificationKeys.push(await pgp.readKey({ armoredKey: key }));
            } catch { /* skip */ }
        }
        if (verificationKeys.length > 0) options.verificationKeys = verificationKeys;

        const { data: decrypted, signatures } = await pgp.decrypt(options);

        let verified = false;
        if (signatures?.length) {
            for (const sig of signatures) {
                try {
                    await sig.verified;
                    verified = true;
                    break;
                } catch { /* continue */ }
            }
        }

        return { decrypted, verified };
    }

    async sign(text: string): Promise<string> {
        const pgp = requireOpenPGP();
        if (!this.cachedPrivateKey) throw new Error("No private key configured");
        const message = await pgp.createCleartextMessage({ text });
        return await pgp.sign({ message, signingKeys: this.cachedPrivateKey, format: "armored" });
    }

    async verify(signedMessage: string): Promise<{ valid: boolean; text: string; signedBy?: string }> {
        const pgp = requireOpenPGP();
        try {
            const message = await pgp.readCleartextMessage({ cleartextMessage: signedMessage });
            const verificationKeys: any[] = [];
            if (this.cachedPublicKey) verificationKeys.push(this.cachedPublicKey);
            for (const key of this.keyManager.getAllPublicKeys()) {
                try { verificationKeys.push(await pgp.readKey({ armoredKey: key })); }
                catch { /* skip */ }
            }

            if (verificationKeys.length === 0) {
                return { valid: false, text: message.getText() };
            }

            const { data: text, signatures } = await pgp.verify({ message, verificationKeys });
            for (const sig of signatures) {
                try {
                    await sig.verified;
                    return { valid: true, text, signedBy: sig.keyID.toHex() };
                } catch { /* try next */ }
            }
            return { valid: false, text };
        } catch (err) {
            return { valid: false, text: "", signedBy: `Error: ${err}` };
        }
    }

    async getKeyInfo(armoredKey: string): Promise<{ fingerprint: string; userIDs: string[]; created: Date }> {
        const pgp = requireOpenPGP();
        let key;
        try {
            key = await pgp.readPrivateKey({ armoredKey });
        } catch {
            key = await pgp.readKey({ armoredKey });
        }
        return {
            fingerprint: key.getFingerprint().toUpperCase(),
            userIDs: key.getUserIDs(),
            created: key.keyPacket.created,
        };
    }

    async searchKeyserver(query: string, keyserver: KeyserverName = "OPENPGP"): Promise<{ found: boolean; keys: string[] }> {
        const serverUrl = KEYSERVERS[keyserver];
        try {
            const searchParam = query.includes("@") ? query : (query.startsWith("0x") ? query : `0x${query}`);
            const response = await fetch(`${serverUrl}/pks/lookup?op=get&options=mr&search=${encodeURIComponent(searchParam)}`);
            if (response.ok) {
                const text = await response.text();
                const keys = text.match(/-----BEGIN PGP PUBLIC KEY BLOCK-----[\s\S]*?-----END PGP PUBLIC KEY BLOCK-----/g) || [];
                return { found: keys.length > 0, keys };
            }
            return { found: false, keys: [] };
        } catch {
            return { found: false, keys: [] };
        }
    }

    hasKeyPair(): boolean { return this.cachedPrivateKey !== null; }
    getFingerprint(): string | null { return this.cachedPublicKey?.getFingerprint().toUpperCase() || null; }
    getPublicKey(): string | null { return settings.store.publicKey || null; }

    clearKeys(): void {
        settings.store.privateKey = "";
        settings.store.publicKey = "";
        settings.store.passphrase = "";
        this.cachedPrivateKey = null;
        this.cachedPublicKey = null;
    }
}

// ============================================================================
// LAZY GLOBAL INSTANCES
// ============================================================================

let keyManagerInstance: KeyManager | null = null;
let pgpEngineInstance: PGPEngine | null = null;

function getKeyManager(): KeyManager {
    if (!keyManagerInstance) {
        keyManagerInstance = new KeyManager();
    }
    return keyManagerInstance;
}

function getPGPEngine(): PGPEngine {
    if (!pgpEngineInstance) {
        pgpEngineInstance = new PGPEngine(getKeyManager());
    }
    return pgpEngineInstance;
}

// ============================================================================
// HELPER
// ============================================================================

function formatFingerprint(fp: string): string {
    return fp.match(/.{1,4}/g)?.join(" ") || fp;
}

// ============================================================================
// UI COMPONENTS
// ============================================================================

enum Tab { MyKey = "my-key", Contacts = "contacts", Generate = "generate", Import = "import", Keyserver = "keyserver" }

function KeyManagerModal({ onClose }: { onClose: () => void }) {
    const [tab, setTab] = useState<Tab>(Tab.MyKey);
    const [ready, setReady] = useState(openpgpLoaded);

    useEffect(() => {
        if (!openpgpLoaded) {
            loadOpenPGP().then(() => setReady(true)).catch(() => setReady(false));
        }
    }, []);

    if (!ready) {
        return (
            <ModalRoot size={ModalSize.MEDIUM}>
                <ModalHeader>
                    <Text variant="heading-lg/semibold">🔐 PGP Key Manager</Text>
                    <ModalCloseButton onClick={onClose} />
                </ModalHeader>
                <ModalContent>
                    <div style={{ padding: "32px", textAlign: "center" }}>
                        <Text variant="text-lg/normal">Loading OpenPGP.js...</Text>
                    </div>
                </ModalContent>
            </ModalRoot>
        );
    }

    return (
        <ModalRoot size={ModalSize.LARGE}>
            <ModalHeader>
                <Text variant="heading-lg/semibold">🔐 PGP Key Manager</Text>
                <ModalCloseButton onClick={onClose} />
            </ModalHeader>
            <ModalContent>
                <TabBar type="top" look="brand" selectedItem={tab} onItemSelect={setTab} className={Margins.bottom16}>
                    <TabBar.Item id={Tab.MyKey}>My Key</TabBar.Item>
                    <TabBar.Item id={Tab.Contacts}>Contacts</TabBar.Item>
                    <TabBar.Item id={Tab.Generate}>Generate</TabBar.Item>
                    <TabBar.Item id={Tab.Import}>Import</TabBar.Item>
                    <TabBar.Item id={Tab.Keyserver}>Keyserver</TabBar.Item>
                </TabBar>
                {tab === Tab.MyKey && <MyKeyTab />}
                {tab === Tab.Contacts && <ContactsTab />}
                {tab === Tab.Generate && <GenerateTab />}
                {tab === Tab.Import && <ImportTab />}
                {tab === Tab.Keyserver && <KeyserverTab />}
            </ModalContent>
        </ModalRoot>
    );
}

function MyKeyTab() {
    const [keyInfo, setKeyInfo] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            const pk = getPGPEngine().getPublicKey();
            if (pk) {
                try { setKeyInfo(await getPGPEngine().getKeyInfo(pk)); }
                catch { /* ignore */ }
            }
            setLoading(false);
        })();
    }, []);

    if (loading) return <Text>Loading...</Text>;
    if (!keyInfo) return (
        <div style={{ padding: "16px", textAlign: "center" }}>
            <Text variant="heading-md/normal">No key pair configured</Text>
            <Text variant="text-md/normal" style={{ color: "var(--text-muted)", marginTop: "8px" }}>
                Go to Generate tab to create a new key.
            </Text>
        </div>
    );

    return (
        <div style={{ padding: "8px" }}>
            <Forms.FormSection title="Key Information">
                <div style={{ background: "var(--background-secondary)", padding: "16px", borderRadius: "8px", marginBottom: "16px" }}>
                    <div style={{ marginBottom: "8px" }}><Text variant="text-sm/semibold">Fingerprint:</Text></div>
                    <Text style={{ fontFamily: "monospace", wordBreak: "break-all" }}>{formatFingerprint(keyInfo.fingerprint)}</Text>
                    <div style={{ marginTop: "12px", marginBottom: "8px" }}><Text variant="text-sm/semibold">User ID:</Text></div>
                    <Text>{keyInfo.userIDs.join(", ")}</Text>
                </div>
            </Forms.FormSection>
            <Forms.FormSection title="Public Key">
                <TextArea value={getPGPEngine().getPublicKey() || ""} disabled rows={6} style={{ fontFamily: "monospace", fontSize: "11px" }} />
                <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                    <Button onClick={() => { navigator.clipboard.writeText(getPGPEngine().getPublicKey()!); Toasts.show({ message: "Copied!", type: Toasts.Type.SUCCESS, id: Toasts.genId() }); }}>Copy</Button>
                    <Button color={Button.Colors.RED} onClick={() => { if (confirm("Delete keys?")) { getPGPEngine().clearKeys(); setKeyInfo(null); } }}>Delete</Button>
                </div>
            </Forms.FormSection>
        </div>
    );
}

function ContactsTab() {
    const [contacts, setContacts] = useState(getKeyManager().getAllKeysWithUsers());

    if (contacts.length === 0) return (
        <div style={{ padding: "16px", textAlign: "center" }}>
            <Text variant="heading-md/normal">No contacts</Text>
            <Text variant="text-md/normal" style={{ color: "var(--text-muted)" }}>Import keys in the Import tab.</Text>
        </div>
    );

    return (
        <div style={{ padding: "8px" }}>
            <Forms.FormSection title={`Contacts (${contacts.length})`}>
                {contacts.map(({ userId, key }) => {
                    const user = UserStore.getUser(userId);
                    return (
                        <div key={userId} style={{ background: "var(--background-secondary)", padding: "12px", borderRadius: "8px", marginBottom: "8px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <div>
                                <Text variant="text-md/semibold">{user?.username || userId}</Text>
                                {key.verified && <span style={{ marginLeft: "8px", background: "var(--status-positive)", color: "white", padding: "2px 6px", borderRadius: "4px", fontSize: "10px" }}>✓</span>}
                                <div><Text variant="text-xs/normal" style={{ fontFamily: "monospace", color: "var(--text-muted)" }}>{key.fingerprint.substring(0, 16)}...</Text></div>
                            </div>
                            <div style={{ display: "flex", gap: "8px" }}>
                                {!key.verified && <Button size={Button.Sizes.SMALL} onClick={() => { getKeyManager().verifyKey(userId); setContacts(getKeyManager().getAllKeysWithUsers()); }}>Verify</Button>}
                                <Button size={Button.Sizes.SMALL} color={Button.Colors.RED} onClick={() => { getKeyManager().removeKeyForUser(userId); setContacts(getKeyManager().getAllKeysWithUsers()); }}>Remove</Button>
                            </div>
                        </div>
                    );
                })}
            </Forms.FormSection>
        </div>
    );
}

function GenerateTab() {
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [pass, setPass] = useState("");
    const [pass2, setPass2] = useState("");
    const [type, setType] = useState<"ecc" | "rsa">("ecc");
    const [generating, setGenerating] = useState(false);

    const generate = useCallback(async () => {
        if (!name || !email) { Toasts.show({ message: "Name and email required", type: Toasts.Type.FAILURE, id: Toasts.genId() }); return; }
        if (pass !== pass2) { Toasts.show({ message: "Passphrases don't match", type: Toasts.Type.FAILURE, id: Toasts.genId() }); return; }
        if (pass.length < 8) { Toasts.show({ message: "Passphrase too short (8+ chars)", type: Toasts.Type.FAILURE, id: Toasts.genId() }); return; }

        setGenerating(true);
        try {
            await getPGPEngine().generateKeyPair(name, email, pass, type);
            Toasts.show({ message: "Key pair generated!", type: Toasts.Type.SUCCESS, id: Toasts.genId() });
            setName(""); setEmail(""); setPass(""); setPass2("");
        } catch (e) {
            Toasts.show({ message: `Error: ${e}`, type: Toasts.Type.FAILURE, id: Toasts.genId() });
        } finally {
            setGenerating(false);
        }
    }, [name, email, pass, pass2, type]);

    return (
        <div style={{ padding: "8px" }}>
            <Forms.FormSection title="Generate New Key Pair">
                <Forms.FormTitle>Name</Forms.FormTitle>
                <TextInput value={name} onChange={setName} placeholder="Your Name" className={Margins.bottom16} />
                <Forms.FormTitle>Email</Forms.FormTitle>
                <TextInput value={email} onChange={setEmail} placeholder="you@example.com" className={Margins.bottom16} />
                <Forms.FormTitle>Passphrase</Forms.FormTitle>
                <TextInput type="password" value={pass} onChange={setPass} placeholder="Min 8 characters" className={Margins.bottom16} />
                <Forms.FormTitle>Confirm Passphrase</Forms.FormTitle>
                <TextInput type="password" value={pass2} onChange={setPass2} placeholder="Confirm" className={Margins.bottom16} />
                <Forms.FormTitle>Key Type</Forms.FormTitle>
                <Select options={[{ value: "ecc", label: "ECC (Curve25519)" }, { value: "rsa", label: "RSA 4096" }]} select={setType} isSelected={v => v === type} serialize={v => v} className={Margins.bottom16} />
                <Button onClick={generate} disabled={generating}>{generating ? "Generating..." : "Generate"}</Button>
            </Forms.FormSection>
        </div>
    );
}

function ImportTab() {
    const [mode, setMode] = useState<"contact" | "private">("contact");
    const [key, setKey] = useState("");
    const [pass, setPass] = useState("");
    const [userId, setUserId] = useState("");
    const [importing, setImporting] = useState(false);

    const doImport = useCallback(async () => {
        if (!key.trim()) { Toasts.show({ message: "Paste a key", type: Toasts.Type.FAILURE, id: Toasts.genId() }); return; }
        setImporting(true);
        try {
            if (mode === "private") {
                await getPGPEngine().importPrivateKey(key, pass);
                Toasts.show({ message: "Private key imported!", type: Toasts.Type.SUCCESS, id: Toasts.genId() });
            } else {
                if (!userId.trim()) { Toasts.show({ message: "Enter user ID", type: Toasts.Type.FAILURE, id: Toasts.genId() }); setImporting(false); return; }
                await getKeyManager().importPublicKeyForUser(userId, key);
                Toasts.show({ message: "Contact key imported!", type: Toasts.Type.SUCCESS, id: Toasts.genId() });
            }
            setKey(""); setPass(""); setUserId("");
        } catch (e) {
            Toasts.show({ message: `Error: ${e}`, type: Toasts.Type.FAILURE, id: Toasts.genId() });
        } finally {
            setImporting(false);
        }
    }, [mode, key, pass, userId]);

    return (
        <div style={{ padding: "8px" }}>
            <Forms.FormSection title="Import Key">
                <Forms.FormTitle>Type</Forms.FormTitle>
                <Select options={[{ value: "contact", label: "Contact's Public Key" }, { value: "private", label: "My Private Key" }]} select={setMode} isSelected={v => v === mode} serialize={v => v} className={Margins.bottom16} />
                {mode === "contact" && (
                    <>
                        <Forms.FormTitle>Discord User ID</Forms.FormTitle>
                        <TextInput value={userId} onChange={setUserId} placeholder="Right-click user → Copy ID" className={Margins.bottom16} />
                    </>
                )}
                <Forms.FormTitle>PGP Key</Forms.FormTitle>
                <TextArea value={key} onChange={setKey} placeholder="-----BEGIN PGP PUBLIC KEY BLOCK-----" rows={8} style={{ fontFamily: "monospace", fontSize: "11px" }} className={Margins.bottom16} />
                {mode === "private" && (
                    <>
                        <Forms.FormTitle>Passphrase</Forms.FormTitle>
                        <TextInput type="password" value={pass} onChange={setPass} placeholder="Key passphrase" className={Margins.bottom16} />
                    </>
                )}
                <Button onClick={doImport} disabled={importing}>{importing ? "Importing..." : "Import"}</Button>
            </Forms.FormSection>
        </div>
    );
}

function KeyserverTab() {
    const [query, setQuery] = useState("");
    const [searching, setSearching] = useState(false);
    const [results, setResults] = useState<Array<{ key: string; info: any }>>([]);
    const [selected, setSelected] = useState<string | null>(null);
    const [importId, setImportId] = useState("");

    const search = useCallback(async () => {
        if (!query.trim()) return;
        setSearching(true);
        setResults([]);
        try {
            const r = await getPGPEngine().searchKeyserver(query);
            if (r.found) {
                const res = [];
                for (const k of r.keys.slice(0, 5)) {
                    try { res.push({ key: k, info: await getPGPEngine().getKeyInfo(k) }); }
                    catch { res.push({ key: k, info: null }); }
                }
                setResults(res);
                Toasts.show({ message: `Found ${r.keys.length} key(s)`, type: Toasts.Type.SUCCESS, id: Toasts.genId() });
            } else {
                Toasts.show({ message: "No keys found", type: Toasts.Type.FAILURE, id: Toasts.genId() });
            }
        } finally {
            setSearching(false);
        }
    }, [query]);

    return (
        <div style={{ padding: "8px" }}>
            <Forms.FormSection title="Search Keyserver">
                <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
                    <TextInput value={query} onChange={setQuery} placeholder="Email or key ID" style={{ flex: 1 }} />
                    <Button onClick={search} disabled={searching}>{searching ? "..." : "Search"}</Button>
                </div>
                {results.length > 0 && (
                    <div style={{ background: "var(--background-secondary)", padding: "12px", borderRadius: "8px" }}>
                        {results.map(({ key, info }, i) => (
                            <div key={i} onClick={() => setSelected(key)} style={{ padding: "8px", marginBottom: "4px", borderRadius: "4px", cursor: "pointer", background: selected === key ? "var(--brand-experiment)" : "var(--background-tertiary)" }}>
                                <Text variant="text-sm/semibold">{info?.userIDs[0] || `Key ${i + 1}`}</Text>
                                {info && <div><Text variant="text-xs/normal" style={{ fontFamily: "monospace" }}>{info.fingerprint.substring(0, 16)}...</Text></div>}
                            </div>
                        ))}
                        {selected && (
                            <div style={{ marginTop: "12px", display: "flex", gap: "8px" }}>
                                <TextInput value={importId} onChange={setImportId} placeholder="Discord User ID" style={{ flex: 1 }} />
                                <Button onClick={async () => {
                                    if (!importId.trim()) return;
                                    try {
                                        await getKeyManager().importPublicKeyForUser(importId, selected);
                                        Toasts.show({ message: "Imported!", type: Toasts.Type.SUCCESS, id: Toasts.genId() });
                                        setSelected(null); setImportId("");
                                    } catch (e) {
                                        Toasts.show({ message: `Error: ${e}`, type: Toasts.Type.FAILURE, id: Toasts.genId() });
                                    }
                                }}>Import</Button>
                            </div>
                        )}
                    </div>
                )}
            </Forms.FormSection>
        </div>
    );
}

function openKeyManagerModal() {
    openModal(props => <KeyManagerModal onClose={props.onClose} />);
}

// ============================================================================
// PLUGIN
// ============================================================================

export default definePlugin({
    name: "PGP",
    description: "End-to-end PGP encryption for Discord. Use /pgp commands.",
    authors: [{ name: "You", id: 0n }],
    tags: ["Privacy", "Utility"],
    enabledByDefault: false,
    settings,

    commands: [
        {
            name: "pgp",
            description: "PGP encryption commands",
            options: [
                { name: "keys", description: "Open key manager", type: 1 },
                { name: "encrypt", description: "Encrypt a message", type: 1, options: [
                    { name: "message", description: "Message", type: 3, required: true },
                    { name: "user", description: "Recipient", type: 6, required: true }
                ]},
                { name: "decrypt", description: "Decrypt a message", type: 1, options: [
                    { name: "message", description: "PGP message", type: 3, required: true }
                ]},
                { name: "sign", description: "Sign a message", type: 1, options: [
                    { name: "message", description: "Message", type: 3, required: true }
                ]},
                { name: "verify", description: "Verify signature", type: 1, options: [
                    { name: "message", description: "Signed message", type: 3, required: true }
                ]},
                { name: "sharekey", description: "Share your public key", type: 1 },
                { name: "fingerprint", description: "Show your fingerprint", type: 1 },
            ],
            async execute(args, ctx) {
                // Ensure OpenPGP is loaded
                if (!openpgpLoaded) {
                    try {
                        await loadOpenPGP();
                    } catch {
                        return { content: "❌ Failed to load OpenPGP.js" };
                    }
                }

                const sub = args[0];
                const getOpt = (n: string) => sub.options?.find((o: any) => o.name === n)?.value;

                switch (sub.name) {
                    case "keys":
                        openKeyManagerModal();
                        return { content: "Opening key manager..." };

                    case "encrypt": {
                        const key = getKeyManager().getPublicKeyForUser(getOpt("user"));
                        if (!key) return { content: "❌ No key for this user. Use `/pgp keys` to import." };
                        try {
                            const enc = await getPGPEngine().encrypt(getOpt("message"), key, settings.store.signMessages);
                            return { content: `${settings.store.encryptionIndicator}\n${enc}` };
                        } catch (e) { return { content: `❌ ${e}` }; }
                    }

                    case "decrypt": {
                        try {
                            const r = await getPGPEngine().decrypt(getOpt("message"));
                            return { content: `🔓${r.verified ? " ✅" : ""}\n${r.decrypted}` };
                        } catch (e) { return { content: `❌ ${e}` }; }
                    }

                    case "sign": {
                        if (!getPGPEngine().hasKeyPair()) return { content: "❌ No key. Use `/pgp keys` to generate." };
                        try {
                            const s = await getPGPEngine().sign(getOpt("message"));
                            return { content: `✍️\n\`\`\`\n${s}\n\`\`\`` };
                        } catch (e) { return { content: `❌ ${e}` }; }
                    }

                    case "verify": {
                        try {
                            const r = await getPGPEngine().verify(getOpt("message"));
                            return { content: r.valid ? `✅ Valid signature\n\n${r.text}` : `❌ Invalid\n\n${r.text}` };
                        } catch (e) { return { content: `❌ ${e}` }; }
                    }

                    case "sharekey": {
                        const k = getPGPEngine().getPublicKey();
                        return k ? { content: `📤\n\`\`\`\n${k}\n\`\`\`` } : { content: "❌ No key configured" };
                    }

                    case "fingerprint": {
                        const fp = getPGPEngine().getFingerprint();
                        return fp ? { content: `🔑 \`${formatFingerprint(fp)}\`` } : { content: "❌ No key configured" };
                    }
                }
            }
        }
    ],

    async start() {
        logger.info("PGP plugin starting...");
        try {
            await loadOpenPGP();
            await getPGPEngine().initialize();
            logger.info("PGP plugin ready");
        } catch (err) {
            logger.error("Failed to initialize:", err);
        }
    },

    stop() {
        logger.info("PGP plugin stopped");
    },
});