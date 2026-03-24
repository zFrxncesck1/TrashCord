import { DataStore } from "@api/index";
import { Flex } from "@components/Flex";
import { Paragraph } from "@components/Paragraph";
import { Devs } from "@utils/constants";
import definePlugin, { PluginNative } from "@utils/types";
import { findComponentByCodeLazy } from "@webpack";
import { Alerts, Button, FluxDispatcher, Toasts, UserProfileStore, UserStore } from "@webpack/common";

const native = VencordNative.pluginHelpers.Identity as PluginNative<typeof import("./native")>;
const CustomizationSection = findComponentByCodeLazy(".DESCRIPTION", "hasBackground:");

const toBase64 = async (imgUrl: string): Promise<string> => {
    const json = await native.ToBase64ImageUrl({ imgUrl });
    return JSON.parse(json).data;
};

async function randomize() {
    try {
        const person = JSON.parse(await native.RequestRandomUser());
        const pfpBase64 = await toBase64(person.picture.large);

        FluxDispatcher.dispatch({ type: "USER_SETTINGS_ACCOUNT_SET_PENDING_AVATAR", avatar: pfpBase64 });
        FluxDispatcher.dispatch({
            type: "USER_SETTINGS_ACCOUNT_SET_PENDING_GLOBAL_NAME",
            globalName: `${person.name.first} ${person.name.last}`
        });
        FluxDispatcher.dispatch({
            type: "USER_SETTINGS_ACCOUNT_SET_PENDING_PRONOUNS",
            pronouns: person.gender === "male" ? "he/him" : person.gender === "female" ? "she/her" : ""
        });
        FluxDispatcher.dispatch({ type: "USER_SETTINGS_ACCOUNT_SET_PENDING_BANNER", banner: null });
        FluxDispatcher.dispatch({ type: "USER_SETTINGS_ACCOUNT_SET_PENDING_ACCENT_COLOR", color: null });
        FluxDispatcher.dispatch({ type: "USER_SETTINGS_ACCOUNT_SET_PENDING_THEME_COLORS", themeColors: [null, null] });
        FluxDispatcher.dispatch({
            type: "USER_SETTINGS_ACCOUNT_SET_PENDING_BIO",
            bio: `Hello! I am ${person.name.first} ${person.name.last}`
        });

        Toasts.show({ message: "Random profile applied!", id: Toasts.genId(), type: Toasts.Type.SUCCESS });
    } catch (error) {
        console.error("[Identity] Randomize failed:", error);
        Toasts.show({ message: "Randomization failed. Check console.", id: Toasts.genId(), type: Toasts.Type.FAILURE });
    }
}

async function saveBase() {
    try {
        const currentUser = UserStore.getCurrentUser();
        const profile = UserProfileStore.getUserProfile(currentUser.id);
        if (!profile) throw new Error("User profile not found");

        const avatarUrl = currentUser.avatar
            ? `https://cdn.discordapp.com/avatars/${currentUser.id}/${currentUser.avatar}.webp?size=4096`
            : `https://cdn.discordapp.com/embed/avatars/${(currentUser.discriminator ?? currentUser.id) % 5}.png`;

        const bannerUrl = profile.banner
            ? `https://cdn.discordapp.com/banners/${currentUser.id}/${profile.banner}.webp?size=4096`
            : null;

        const [pfpBase64, bannerBase64] = await Promise.all([
            toBase64(avatarUrl),
            bannerUrl ? toBase64(bannerUrl) : Promise.resolve(null)
        ]);

        const savedData = {
            globalName: currentUser.globalName,
            pronouns: profile.pronouns,
            bio: profile.bio,
            accentColor: profile.accentColor,
            themeColors: profile.themeColors,
            banner: profile.banner,
            avatarDecoration: profile.avatarDecoration,
            fetchedBase64Data: { pfpBase64, bannerBase64 }
        };

        await DataStore.set("identity-saved-base", JSON.stringify(savedData));
        Toasts.show({ message: "Base profile saved!", id: Toasts.genId(), type: Toasts.Type.SUCCESS });
    } catch (error) {
        console.error("[Identity] Save failed:", error);
        Toasts.show({ message: "Save failed. Check console.", id: Toasts.genId(), type: Toasts.Type.FAILURE });
    }
}

async function loadBase() {
    const raw = await DataStore.get("identity-saved-base");
    if (!raw) {
        Toasts.show({ message: "No saved base found. Save one first.", id: Toasts.genId(), type: Toasts.Type.FAILURE });
        return;
    }

    try {
        const data = JSON.parse(raw);
        const { pfpBase64, bannerBase64 } = data.fetchedBase64Data;

        FluxDispatcher.dispatch({ type: "USER_SETTINGS_ACCOUNT_SET_PENDING_AVATAR", avatar: pfpBase64 });
        FluxDispatcher.dispatch({ type: "USER_SETTINGS_ACCOUNT_SET_PENDING_GLOBAL_NAME", globalName: data.globalName });
        FluxDispatcher.dispatch({ type: "USER_SETTINGS_ACCOUNT_SET_PENDING_PRONOUNS", pronouns: data.pronouns });
        FluxDispatcher.dispatch({ type: "USER_SETTINGS_ACCOUNT_SET_PENDING_BANNER", banner: bannerBase64 });
        FluxDispatcher.dispatch({ type: "USER_SETTINGS_ACCOUNT_SET_PENDING_ACCENT_COLOR", color: data.accentColor });
        FluxDispatcher.dispatch({ type: "USER_SETTINGS_ACCOUNT_SET_PENDING_THEME_COLORS", themeColors: data.themeColors });
        FluxDispatcher.dispatch({ type: "USER_SETTINGS_ACCOUNT_SET_PENDING_BIO", bio: data.bio });

        Toasts.show({ message: "Base profile loaded!", id: Toasts.genId(), type: Toasts.Type.SUCCESS });
    } catch (error) {
        console.error("[Identity] Load failed:", error);
        Toasts.show({ message: "Load failed. Data may be corrupted.", id: Toasts.genId(), type: Toasts.Type.FAILURE });
    }
}

function ResetCard() {
    if (!CustomizationSection) return null;

    return (
        <CustomizationSection title="Identity" hasBackground hideDivider={false}>
            <Flex>
                <Button
                    onClick={() => {
                        Alerts.show({
                            title: "Hold on!",
                            body: (
                                <div>
                                    <Paragraph>
                                        Saving your base profile will allow you to have a backup of your actual profile.
                                    </Paragraph>
                                    <Paragraph>
                                        If you save, it will overwrite your previous data.
                                    </Paragraph>
                                </div>
                            ),
                            confirmText: "Save Anyway",
                            cancelText: "Cancel",
                            onConfirm: saveBase
                        });
                    }}
                    size={Button.Sizes.MEDIUM}
                >
                    Save Base
                </Button>
                <Button
                    onClick={() => {
                        Alerts.show({
                            title: "Hold on!",
                            body: (
                                <div>
                                    <Paragraph>
                                        Loading your base profile will restore your actual profile settings.
                                    </Paragraph>
                                    <Paragraph>
                                        If you load, it will overwrite your current profile configuration.
                                    </Paragraph>
                                </div>
                            ),
                            confirmText: "Load Anyway",
                            cancelText: "Cancel",
                            onConfirm: loadBase
                        });
                    }}
                    size={Button.Sizes.MEDIUM}
                >
                    Load Base
                </Button>
                <Button onClick={randomize} size={Button.Sizes.MEDIUM}>
                    Randomize
                </Button>
            </Flex>
        </CustomizationSection>
    );
}

export default definePlugin({
    name: "Identity",
    description: "Allows you to edit your profile to a random fake person with the click of a button",
    authors: [
        { name: "x2b", id: 0n },
        { name: "zFrxncesck1", id: 456195985404592149n },
    ],
    ResetCard,
    patches: [
        {
            find: "DefaultCustomizationSections",
            replacement: {
                match: /(?<=#{intl::USER_SETTINGS_AVATAR_DECORATION}\)},"decoration"\),)/,
                replace: "$self.ResetCard(),"
            }
        }
    ]
});