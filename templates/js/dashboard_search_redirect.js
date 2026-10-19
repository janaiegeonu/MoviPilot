(() => {
    "use strict";

    document.addEventListener("DOMContentLoaded", () => {
        const input = document.getElementById("dashboardSearch");
        const button = document.getElementById("searchButton");
        if (!input || !button) return;

        const openSearchPage = (event) => {
            const query = input.value.trim();

            // Empty dashboard searches must not redirect or load /search.
            if (!query) {
                event?.preventDefault();
                input.focus();
                return;
            }

            event?.preventDefault();
            window.location.assign(`/search?q=${encodeURIComponent(query)}`);
        };

        button.addEventListener("click", openSearchPage);

        // Intercept a containing form too, so native submission cannot bypass the empty check.
        input.form?.addEventListener("submit", openSearchPage);

        input.addEventListener("keydown", (event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            openSearchPage(event);
        });
    });
})();
