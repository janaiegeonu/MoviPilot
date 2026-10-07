/* =========================================================
   MOVIPILOT EXPLORE BRIDGE
   ---------------------------------------------------------
   One delegated click handler supports cards that are
   rendered on the dashboard, Movies page, and Series page.
   ========================================================= */

(() => {
    "use strict";

    document.addEventListener("click", (event) => {
        const button = event.target.closest(
            ".mp-explore-button, .movie-explore-button, .series-explore-button"
        );

        if (!button) return;

        const movieID = button.dataset.movieId;
        const seriesID = button.dataset.seriesId;

        const mediaType = seriesID ? "tv" : "movie";
        const mediaID = seriesID || movieID;

        if (!mediaID || !/^\d+$/.test(mediaID)) {
            console.error("[MOVIPILOT] Explore button has no valid media id.");
            return;
        }

        event.preventDefault();

        window.location.href =
            `/explore?type=${encodeURIComponent(mediaType)}&id=${encodeURIComponent(mediaID)}`;
    });
})();
