import definePlugin from "@utils/types";

export default definePlugin({
    name: "HideServerActivity",
    description: "Hides the 'Activity' from server members list.",
    authors: [{
        name: "zaher-neon",
        id: 495198426724564995n
    }],

    start() {
        const hideActivity = () => {
        const aside = document.querySelector('aside[class*="membersWrap"]');
        if (!aside) return;

        var el = aside.querySelector('h3');
        if (el.style.display === "none" || !el.textContent.includes("Activity")) return;
        el.style.display = "none";

        var allDivs = aside.querySelectorAll('div');
        Array.from(allDivs).filter(div => div.attributes.length === 0).forEach(card => {
        card.style.display = "none";
        });
    };

    hideActivity();

    const observer = new MutationObserver(() => hideActivity());
    observer.observe(document.body, { childList: true, subtree: true });
    },
    stop() {}
});