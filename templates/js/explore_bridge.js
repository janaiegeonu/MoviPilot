/* =========================================================
   MOVIPILOT EXPLORE BRIDGE — CANONICAL MEDIA IDENTITY
   ---------------------------------------------------------
   One delegated click handler owns Explore navigation for:
   dashboard, Movies, Series, and mixed Anime cards.

   Canonical media types sent to Go/TMDB are ONLY:
       movie
       tv

   Generic data-media-id is safe only when accompanied by an
   explicit data-media-type. Conflicting metadata is rejected.
   ========================================================= */

(() => {
    "use strict";

    const BUTTON_SELECTOR = [
        ".mp-explore-button",
        ".movie-explore-button",
        ".series-explore-button",
        ".anime-explore-button"
    ].join(", ");

    /* ---------------------------------------------------------
   EXPLORE RETURN-PAGE TRACKING

   Remember the exact page the user was viewing before
   opening Explore. This gives the Back button a reliable
   fallback if browser history is unavailable.
   --------------------------------------------------------- */

const EXPLORE_RETURN_KEY = "movipilot:explore:return:v1";

function rememberExploreReturnPage() {
    try {
        const currentURL = new URL(window.location.href);

        // Only save pages belonging to MoviPilot.
        if (currentURL.origin !== window.location.origin) {
            return;
        }

        sessionStorage.setItem(
            EXPLORE_RETURN_KEY,
            JSON.stringify({
                url: currentURL.href,
                savedAt: Date.now()
            })
        );

    } catch (error) {
        console.warn(
            "[MoviPilot] Could not save Explore return page:",
            error
        );
    }
}

/*
   Capture clicks before the existing Explore bridge handles
   them. This covers Explore buttons and normal Explore links.
*/
document.addEventListener("click", (event) => {
    const target = event.target;

    if (!(target instanceof Element)) {
        return;
    }

    const exploreButton = target.closest(BUTTON_SELECTOR);
    const anchor = target.closest("a[href]");

    let isExploreLink = false;

    if (anchor) {
        try {
            const destination = new URL(
                anchor.href,
                window.location.href
            );

            isExploreLink =
                destination.origin === window.location.origin &&
                destination.pathname.replace(/\/+$/, "") === "/explore";

        } catch (error) {
            console.warn(
                "[MoviPilot] Invalid Explore destination:",
                error
            );
        }
    }

    if (!exploreButton && !isExploreLink) {
        return;
    }

    rememberExploreReturnPage();

}, true);

    function normalizeMediaType(raw) {
        const value = String(raw ?? "").trim().toLowerCase();

        if (value === "movie" || value === "movies") return "movie";
        if (["tv", "series", "tv-series", "tv_series", "tvseries", "show", "shows"].includes(value)) {
            return "tv";
        }

        return "";
    }

    function readID(raw, fieldName) {
        const value = String(raw ?? "").trim();
        if (!value) return { present: false, value: "", error: "" };

        if (!/^\d+$/.test(value)) {
            return { present: true, value: "", error: `${fieldName} must contain a numeric TMDB ID.` };
        }

        const numeric = Number(value);
        if (!Number.isSafeInteger(numeric) || numeric <= 0) {
            return { present: true, value: "", error: `${fieldName} must be a positive safe integer.` };
        }

        return { present: true, value: String(numeric), error: "" };
    }

    function resolveIdentity(button) {
        if (!button || !button.dataset) {
            return { ok: false, error: "Explore button has no readable data attributes." };
        }

        const dataset = button.dataset;
        const movieID = readID(dataset.movieId, "data-movie-id");
        const seriesID = readID(dataset.seriesId, "data-series-id");
        const genericRawID = [dataset.mediaId, dataset.tmdbId, dataset.id]
            .find((value) => String(value ?? "").trim() !== "");
        const genericID = readID(genericRawID, "data-media-id");

        for (const entry of [movieID, seriesID, genericID]) {
            if (entry.error) return { ok: false, error: entry.error };
        }

        const isMovieButton = button.classList?.contains("movie-explore-button") === true;
        const isSeriesButton = button.classList?.contains("series-explore-button") === true;
        if (isMovieButton && isSeriesButton) {
            return { ok: false, error: "Explore button has conflicting movie and series classes." };
        }

        const classType = isMovieButton ? "movie" : (isSeriesButton ? "tv" : "");
        const explicitRawType = String(dataset.mediaType ?? dataset.type ?? "").trim();
        const explicitType = explicitRawType ? normalizeMediaType(explicitRawType) : "";

        if (explicitRawType && !explicitType) {
            return { ok: false, error: `Unsupported Explore media type: ${explicitRawType}` };
        }
        if (explicitType && classType && explicitType !== classType) {
            return {
                ok: false,
                error: `Explore button type conflict: data-media-type is ${explicitType}, but its class identifies ${classType}.`
            };
        }

        let mediaType = explicitType || classType;

        // Legacy generic buttons are accepted only when exactly one typed ID exists.
        if (!mediaType) {
            if (movieID.present && seriesID.present) {
                return { ok: false, error: "Explore button has both movie and series IDs but no explicit media type." };
            }
            if (movieID.present) mediaType = "movie";
            else if (seriesID.present) mediaType = "tv";
            else {
                return { ok: false, error: "Explore button is missing an explicit media type and typed TMDB ID." };
            }
        }

        const typedID = mediaType === "tv" ? seriesID : movieID;
        const oppositeID = mediaType === "tv" ? movieID : seriesID;

        if (!typedID.present && oppositeID.present) {
            return {
                ok: false,
                error: mediaType === "tv"
                    ? "Series Explore button has data-movie-id but no data-series-id."
                    : "Movie Explore button has data-series-id but no data-movie-id."
            };
        }

        if (typedID.present && genericID.present && typedID.value !== genericID.value) {
            return { ok: false, error: "Explore button contains conflicting typed and generic TMDB IDs." };
        }

        const mediaID = typedID.present ? typedID.value : genericID.value;
        if (!mediaID) {
            return {
                ok: false,
                error: mediaType === "tv"
                    ? "Series Explore button is missing data-series-id or data-media-id."
                    : "Movie Explore button is missing data-movie-id or data-media-id."
            };
        }

        return { ok: true, mediaType, mediaID };
    }

    // Expose a pure resolver for browser-console diagnostics and unit tests.
    if (typeof window !== "undefined") {
        window.MoviPilotExploreBridge = Object.freeze({ resolveIdentity, normalizeMediaType });
    }

    document.addEventListener("click", (event) => {
        const target = event.target;
        const button = target && typeof target.closest === "function"
            ? target.closest(BUTTON_SELECTOR)
            : null;

        if (!button) return;

        // This bridge is the sole owner of navigation for the matched Explore controls.
        event.preventDefault();

        const identity = resolveIdentity(button);
        if (!identity.ok) {
            console.error(`[MOVIPILOT EXPLORE] ${identity.error}`, button);
            return;
        }

        const query = new URLSearchParams({
            type: identity.mediaType,
            id: identity.mediaID
        });

        window.location.assign(`/explore?${query.toString()}`);
    });
})();