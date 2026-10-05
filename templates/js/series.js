/* =========================================================
   MOVIPILOT SERIES PAGE JAVASCRIPT
   ========================================================= */

(() => {

    "use strict";


    console.log(
        "MOVIPILOT SERIES PAGE JS LOADED"
    );


    /* =====================================================
       GLOBAL CACHE
       ===================================================== */

    /*
        Keep Series card HTML alive even when the Series page
        is removed from the dashboard.

        Example:

            Series
              ↓
            Movies
              ↓
            Series

        The previous Series HTML can be shown immediately.
    */

    const seriesHTMLCache =
        window.__movipilotSeriesHTMLCache ||
        new Map();


    window.__movipilotSeriesHTMLCache =
        seriesHTMLCache;


    /* =====================================================
       GLOBAL REQUEST STATE
       ===================================================== */

    const seriesPageState =
        window.__movipilotSeriesPageState ||
        {
            controller: null,
            requestSerial: 0
        };


    window.__movipilotSeriesPageState =
        seriesPageState;


    /* =====================================================
       FILTER INFORMATION
       ===================================================== */

    const seriesFilterInfo = {

        all: {
            title:
                "Series for You"
        },

        new: {
            title:
                "New Series"
        },

        upcoming: {
            title:
                "Upcoming Series"
        },

        "top-rated": {
            title:
                "Top Rated Series"
        },

        horror: {
            title:
                "Horror Series"
        },

        anime: {
            title:
                "Anime Series"
        },

        romance: {
            title:
                "Romance Series"
        },

        action: {
            title:
                "Action Series"
        }

    };


    /* =====================================================
       SKELETON GENERATOR
       ===================================================== */

    function createSkeletonCards(
        count = 18
    ) {

        const cards = [];


        for (
            let i = 0;
            i < count;
            i++
        ) {

            cards.push(`

                <div
                    class="series-skeleton-card"
                >

                    <div
                        class="series-skeleton-poster"
                    ></div>

                    <div
                        class="series-skeleton-line"
                    ></div>

                    <div
                        class="series-skeleton-line short"
                    ></div>

                </div>

            `);

        }


        return `

            <div
                class="series-skeleton-grid"
            >

                ${cards.join("")}

            </div>

        `;

    }


    /* =====================================================
       INITIALIZE SERIES PAGE
       ===================================================== */

    window.initSeriesPage =
        async function () {

            /*
                IMPORTANT:

                The Series HTML has already been inserted
                by dashboard.js before this function runs.
            */

            const seriesPage =
                document.getElementById(
                    "seriesPage"
                );


            if (!seriesPage) {

                console.warn(
                    "[MOVIPILOT SERIES] #seriesPage not found."
                );

                return;

            }


            /*
                Prevent accidental double initialization
                on the same DOM instance.
            */

            if (
                seriesPage.dataset.initialized ===
                "true"
            ) {

                return;

            }


            seriesPage.dataset.initialized =
                "true";


            /* =================================================
               ELEMENTS
               ================================================= */

            const results =
                seriesPage.querySelector(
                    "#seriesResults"
                );


            const resultsTitle =
                seriesPage.querySelector(
                    "#seriesResultsTitle"
                );


            const resultsCount =
                seriesPage.querySelector(
                    "#seriesResultsCount"
                );


            const filterButtons =
                Array.from(
                    seriesPage.querySelectorAll(
                        ".series-filter-button"
                    )
                );


            if (!results) {

                console.error(
                    "[MOVIPILOT SERIES] #seriesResults not found."
                );

                return;

            }


            /* =================================================
               ACTIVE FILTER
               ================================================= */

            function setActiveFilter(
                activeButton
            ) {

                filterButtons.forEach(
                    (button) => {

                        const isActive =
                            button ===
                            activeButton;


                        button.classList.toggle(
                            "is-active",
                            isActive
                        );


                        button.setAttribute(
                            "aria-pressed",
                            String(isActive)
                        );

                    }
                );

            }


            /* =================================================
               HEADER
               ================================================= */

            function updateHeader(
                filter,
                count
            ) {

                if (
                    resultsTitle &&
                    seriesFilterInfo[filter]
                ) {

                    resultsTitle.textContent =
                        seriesFilterInfo[
                            filter
                        ].title;

                }


                if (
                    resultsCount
                ) {

                    resultsCount.textContent =
                        `${count} SERIES`;

                }

            }


            /* =================================================
               IMAGE INITIALIZATION
               ================================================= */

            function initializeImages() {

                const images =
                    results.querySelectorAll(
                        ".series-card-poster"
                    );


                images.forEach(
                    (image) => {

                        const media =
                            image.closest(
                                ".series-card-media"
                            );


                        if (!media) {

                            return;

                        }


                        function loaded() {

                            media.classList.add(
                                "is-loaded"
                            );

                            media.classList.remove(
                                "is-error"
                            );

                        }


                        function broken() {

                            media.classList.add(
                                "is-loaded"
                            );

                            media.classList.add(
                                "is-error"
                            );

                        }


                        if (
                            image.complete
                        ) {

                            if (
                                image.naturalWidth >
                                0
                            ) {

                                loaded();

                            } else {

                                broken();

                            }

                        } else {

                            image.addEventListener(
                                "load",
                                loaded,
                                {
                                    once: true
                                }
                            );


                            image.addEventListener(
                                "error",
                                broken,
                                {
                                    once: true
                                }
                            );

                        }

                    }
                );

            }


            /* =================================================
               RENDER RESULTS
               ================================================= */

            function renderResults(
                html,
                filter
            ) {

                results.innerHTML =
                    html;


                const cards =
                    results.querySelectorAll(
                        ".series-card"
                    );


                updateHeader(
                    filter,
                    cards.length
                );


                initializeImages();


                results.setAttribute(
                    "aria-busy",
                    "false"
                );


                results.classList.remove(
                    "is-switching"
                );

            }


            /* =================================================
               LOAD SERIES CARDS
               ================================================= */

            async function loadSeriesCards(
                filter
            ) {

                const requestID =
                    ++seriesPageState.requestSerial;


                /*
                    Cancel previous Series request.
                */

                if (
                    seriesPageState.controller
                ) {

                    seriesPageState
                        .controller
                        .abort();

                }


                const controller =
                    new AbortController();


                seriesPageState.controller =
                    controller;


                /*
                    =================================================
                    BROWSER CACHE
                    =================================================

                    Returning to Series can now be immediate.
                */

                const cachedHTML =
                    seriesHTMLCache.get(
                        filter
                    );


                if (
                    cachedHTML
                ) {

                    renderResults(
                        cachedHTML,
                        filter
                    );

                    return;

                }


                /*
                    =================================================
                    LOADING STATE
                    =================================================
                */

                results.classList.add(
                    "is-switching"
                );


                results.setAttribute(
                    "aria-busy",
                    "true"
                );


                results.innerHTML =
                    createSkeletonCards(
                        18
                    );


                try {

                    const response =
                        await fetch(

                            `/dashboard/series/cards?filter=${
                                encodeURIComponent(
                                    filter
                                )
                            }`,

                            {
                                method:
                                    "GET",

                                signal:
                                    controller.signal,

                                headers: {
                                    "Accept":
                                        "text/html"
                                },

                                /*
                                    DO NOT use no-store.

                                    The server now provides a
                                    short browser cache and also
                                    keeps its own 5-minute data cache.
                                */

                                cache:
                                    "default"
                            }
                        );


                    /*
                        Ignore stale request.
                    */

                    if (
                        requestID !==
                        seriesPageState
                            .requestSerial
                    ) {

                        return;

                    }


                    if (
                        !response.ok
                    ) {

                        throw new Error(
                            `Series cards returned ${response.status}`
                        );

                    }


                    const html =
                        await response.text();


                    /*
                        Another filter may have been
                        clicked while this response
                        was downloading.
                    */

                    if (
                        requestID !==
                        seriesPageState
                            .requestSerial
                    ) {

                        return;

                    }


                    /*
                        Save successful response.
                    */

                    seriesHTMLCache.set(
                        filter,
                        html
                    );


                    /*
                        Render cards.
                    */

                    renderResults(
                        html,
                        filter
                    );


                    console.log(
                        "[MOVIPILOT SERIES]",
                        filter,
                        "loaded:",
                        results.querySelectorAll(
                            ".series-card"
                        ).length,
                        "series"
                    );

                } catch (
                    error
                ) {

                    /*
                        Abort means another request replaced
                        this one.
                    */

                    if (
                        error.name ===
                        "AbortError"
                    ) {

                        return;

                    }


                    console.error(
                        "[MOVIPILOT SERIES]",
                        error
                    );


                    if (
                        requestID !==
                        seriesPageState
                            .requestSerial
                    ) {

                        return;

                    }


                    results.innerHTML = `

                        <div
                            class="series-empty-state"
                        >

                            <span
                                class="series-empty-kicker"
                            >
                                COLLECTION ERROR
                            </span>

                            <h3>
                                This series collection couldn't be loaded.
                            </h3>

                            <p>
                                Please try the category again.
                            </p>

                        </div>

                    `;


                    results.setAttribute(
                        "aria-busy",
                        "false"
                    );


                    results.classList.remove(
                        "is-switching"
                    );


                    updateHeader(
                        filter,
                        0
                    );

                }

            }


            /* =================================================
               FILTER BUTTONS
               ================================================= */

            filterButtons.forEach(
                (button) => {

                    button.addEventListener(
                        "click",
                        async () => {

                            const filter =
                                button.dataset
                                    .seriesFilter;


                            if (
                                !filter ||
                                !seriesFilterInfo[
                                    filter
                                ]
                            ) {

                                return;

                            }


                            /*
                                Update button immediately.
                            */

                            setActiveFilter(
                                button
                            );


                            /*
                                Update heading immediately.
                            */

                            updateHeader(
                                filter,
                                0
                            );


                            /*
                                Load actual cards.
                            */

                            await loadSeriesCards(
                                filter
                            );

                        }
                    );

                }
            );


            /* =================================================
               EXPLORE BUTTON
               ================================================= */

            results.addEventListener(
                "click",
                (event) => {

                    const button =
                        event.target.closest(
                            ".series-explore-button"
                        );


                    if (!button) {

                        return;

                    }


                    const seriesID =
                        button.dataset.seriesId;


                    if (!seriesID) {

                        return;

                    }


                    document.dispatchEvent(

                        new CustomEvent(
                            "movipilot:explore-series",
                            {
                                detail: {
                                    id:
                                        seriesID
                                }
                            }
                        )

                    );

                }
            );


            /* =================================================
               INITIAL FILTER
               ================================================= */

            const initialButton =
                seriesPage.querySelector(
                    ".series-filter-button.is-active"
                );


            const initialFilter =
                initialButton
                    ?.dataset
                    .seriesFilter ||
                "all";


            if (
                initialButton
            ) {

                setActiveFilter(
                    initialButton
                );

            }


            /* =================================================
               FIRST LOAD
               ================================================= */

            await loadSeriesCards(
                initialFilter
            );

        };

})();