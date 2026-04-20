import definePlugin from "@utils/types";

export default definePlugin({
    name: "HideFormFullscreen",
    description: "Hides the chat input during fullscreen DM calls",
    authors: [{ name: "zFrxncesck1", id: 456195985404592149n }],
    start() {
        const s = document.createElement("style");
        s.id = "hff";
        document.head.appendChild(s);
        const u = () => {
            s.textContent = document.querySelector(".fullScreen_cb9592")
                ? ".form_f75fb0{display:none!important}"
                : "";
        };
        this.ob = new MutationObserver(u);
        this.ob.observe(document.body, {
            childList: true,
            subtree: false,
            attributes: true,
            attributeFilter: ["class"]
        });
        u();
    },
    stop() {
        this.ob?.disconnect();
        document.getElementById("hff")?.remove();
    }
});