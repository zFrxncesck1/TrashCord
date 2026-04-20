# HideServerActivity

**Description:**  
Hides the "Activity" section from the server members list in Discord, including any activity cards like playing games, listening to music, or streaming.  

## Two Ways:
### **Using Vencord Custom CSS (Recommended)**
Just go to `Discord Settings` > `Vencord` and 'Enable Custom CSS' then press 'Edit QuickCSS', paste following code:
```CSS
h3.membersGroup_c8ffbb:has(> span > div svg) {
    display: none !important;
}

div.container__0f2e8:has(> div img) {
    display: none !important;
}
```

### **Using Vencord Plugin (Less Efficient)**
👉 [Jump Here For Plugin Installation](https://github.com/zaher-neon/vencord-userplugins)

