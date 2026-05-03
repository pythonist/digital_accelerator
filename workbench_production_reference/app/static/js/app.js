document.addEventListener("alpine:init", () => {
  Alpine.data("shellState", () => ({
    menuOpen: false,
  }));
});
