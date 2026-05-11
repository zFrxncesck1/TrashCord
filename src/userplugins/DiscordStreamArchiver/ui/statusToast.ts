import { Notifications } from "@api/index";

export function show(message: string, onClick?: () => void): void {
    Notifications.showNotification({
        title: "Discord Stream Archiver",
        body: message,
        onClick
    });
}

export function showError(message: string): void {
    Notifications.showNotification({
        title: "Discord Stream Archiver — error",
        body: message
    });
}
