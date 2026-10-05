/* =========================================================
   MOVIPILOT ANIME PAGE
   Dynamic Dashboard Page
   Mixed Movies + TV Series
   ========================================================= */

(() => {

    "use strict";


    console.log(
        "MOVIPILOT ANIME PAGE JS LOADED"
    );


    /* =====================================================
       GLOBAL CACHE
       ===================================================== */

    const animeHTMLCache =
        window.__movipilotAnimeHTMLCache ||
        new Map();


    window.__movipilotAnimeHTMLCache =
        animeHTMLCache;


    /* =====================================================
       GLOBAL STATE
       ===================================================== */

    const animePageState =
        window.__movipilotAnimePageState ||
        {
            controller: null,
            requestSerial: 0,
            currentFilter: "all"
        };


    window.__movipilotAnimePageState =
        animePageState;


    /* =====================================================
       FILTER TITLES
       ===================================================== */

    const animeFilterTitles = {

        all:
            "Anime for You",

        new:
            "New Anime",

        "old-gen":
            "Old Generation Anime",

        upcoming:
            "Upcoming Anime",

        popular:
            "Popular Anime",

        "top-rated":
            "Top Rated Anime",

        action:
            "Action Anime",

        romance:
            "Romance Anime",

        adventure:
            "Adventure Anime",

        magic:
            "Magic Anime",

        mystery:
            "Mystery Anime",

        swordsman:
            "Swordsman Anime",

        ghibli:
            "Studio Ghibli"

    };


    /* =====================================================
       SKELETONS
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
                    class="anime-skeleton-card"
                >

                    <div
                        class="anime-skeleton-poster"
                    ></div>

                    <div
                        class="anime-skeleton-line"
                    ></div>

                    <div
                        class="anime-skeleton-line short"
                    ></div>

                </div>

            `);

        }


        return `

            <div
                class="anime-skeleton-grid"
            >

                ${cards.join("")}

            </div>

        `;

    }


    /* =====================================================
       ADD SKELETON STYLES

       Kept in JS so the core page doesn't require another
       stylesheet for temporary loading elements.
       ===================================================== */

    function ensureSkeletonStyles() {

        if (
            document.getElementById(
                "movipilotAnimeSkeletonStyles"
            )
        ) {

            return;

        }


        const style =
            document.createElement(
                "style"
            );


        style.id =
            "movipilotAnimeSkeletonStyles";


        style.textContent = `

            .anime-skeleton-grid {

                display: grid;

                grid-template-columns:
                    repeat(
                        6,
                        minmax(0, 1fr)
                    );

                gap:
                    29px
                    15px;

            }


            .anime-skeleton-card {

                min-width: 0;

            }


            .anime-skeleton-poster {

                aspect-ratio:
                    2 / 3;

                border-radius:
                    16px;

                background:
                    linear-gradient(
                        110deg,
                        rgba(13, 29, 44, 0.72),
                        rgba(25, 49, 64, 0.55),
                        rgba(13, 29, 44, 0.72)
                    );

                background-size:
                    200% 100%;

                animation:
                    animeSkeletonMove
                    1.4s
                    ease-in-out
                    infinite;

            }


            .anime-skeleton-line {

                width: 78%;
                height: 9px;

                margin-top: 10px;

                border-radius: 5px;

                background:
                    rgba(111, 178, 205, 0.10);

            }


            .anime-skeleton-line.short {

                width: 48%;

                margin-top: 7px;

            }


            @keyframes animeSkeletonMove {

                0% {
                    background-position:
                        200% 0;
                }

                100% {
                    background-position:
                        -200% 0;
                }

            }


            @media (max-width: 1120px) {

                .anime-skeleton-grid {

                    grid-template-columns:
                        repeat(
                            5,
                            minmax(0, 1fr)
                        );

                }

            }


            @media (max-width: 920px) {

                .anime-skeleton-grid {

                    grid-template-columns:
                        repeat(
                            4,
                            minmax(0, 1fr)
                        );

                }

            }


            @media (max-width: 700px) {

                .anime-skeleton-grid {

                    grid-template-columns:
                        repeat(
                            3,
                            minmax(0, 1fr)
                        );

                }

            }


            @media (max-width: 500px) {

                .anime-skeleton-grid {

                    grid-template-columns:
                        repeat(
                            2,
                            minmax(0, 1fr)
                        );

                }

            }

        `;


        document.head.appendChild(
            style
        );

    }


    /* =====================================================
       INITIALIZE ANIME PAGE
       ===================================================== */

    window.initAnimePage =
        async function () {

            const animePage =
                document.getElementById(
                    "animePage"
                );


            if (!animePage) {

                console.warn(
                    "[MOVIPILOT ANIME] #animePage not found."
                );

                return;

            }


            /*
                Protect this specific DOM instance against
                accidental double initialization.
            */

            if (
                animePage.dataset.initialized ===
                "true"
            ) {

                return;

            }


            animePage.dataset.initialized =
                "true";


            ensureSkeletonStyles();


            /* =================================================
               ELEMENTS
               ================================================= */

            const results =
                animePage.querySelector(
                    "#animeResults"
                );


            const resultsTitle =
                animePage.querySelector(
                    "#animeResultsTitle"
                );


            const resultsCount =
                animePage.querySelector(
                    "#animeResultsCount"
                );


            const filterButtons =
                Array.from(
                    animePage.querySelectorAll(
                        ".anime-filter-button"
                    )
                );


            if (!results) {

                console.error(
                    "[MOVIPILOT ANIME] #animeResults not found."
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
               FIND BUTTON
               ================================================= */

            function findFilterButton(
                filter
            ) {

                return filterButtons.find(
                    (button) =>
                        button.dataset
                            .animeFilter ===
                        filter
                );

            }


            /* =================================================
               UPDATE HEADER
               ================================================= */

            function updateHeader(
                filter,
                count
            ) {

                if (
                    resultsTitle
                ) {

                    resultsTitle.textContent =
                        animeFilterTitles[
                            filter
                        ] ||
                        "Anime for You";

                }


                if (
                    resultsCount
                ) {

                    resultsCount.textContent =
                        `${count} ANIME`;

                }

            }


            /* =================================================
               IMAGE INITIALIZATION
               ================================================= */

            function initializeImages() {

                const images =
                    results.querySelectorAll(
                        ".anime-card-poster"
                    );


                images.forEach(
                    (image) => {

                        const media =
                            image.closest(
                                ".anime-card-media"
                            );


                        if (!media) {

                            return;

                        }


                        const markLoaded =
                            () => {

                                media.classList.add(
                                    "is-loaded"
                                );

                            };


                        const markBroken =
                            () => {

                                media.classList.add(
                                    "is-loaded"
                                );

                                media.classList.add(
                                    "is-error"
                                );

                            };


                        if (
                            image.complete
                        ) {

                            if (
                                image.naturalWidth >
                                0
                            ) {

                                markLoaded();

                            } else {

                                markBroken();

                            }

                        } else {

                            image.addEventListener(
                                "load",
                                markLoaded,
                                {
                                    once: true
                                }
                            );


                            image.addEventListener(
                                "error",
                                markBroken,
                                {
                                    once: true
                                }
                            );

                        }

                    }
                );

            }


            /* =================================================
               RENDER
               ================================================= */

            function renderAnimeHTML(
                html,
                filter
            ) {

                results.innerHTML =
                    html;


                const cards =
                    results.querySelectorAll(
                        ".anime-card"
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

            }


            /* =================================================
               LOAD ANIME
               ================================================= */

            async function loadAnimeCards(
                filter
            ) {

                animePageState.currentFilter =
                    filter;


                const requestID =
                    ++animePageState.requestSerial;


                /*
                    Cancel previous request.
                */

                if (
                    animePageState.controller
                ) {

                    animePageState
                        .controller
                        .abort();

                }


                /*
                    New controller.
                */

                const controller =
                    new AbortController();


                animePageState.controller =
                    controller;


                /*
                    =================================================
                    BROWSER CACHE
                    =================================================
                */

                const cachedHTML =
                    animeHTMLCache.get(
                        filter
                    );


                if (
                    cachedHTML
                ) {

                    const button =
                        findFilterButton(
                            filter
                        );


                    if (
                        button
                    ) {

                        setActiveFilter(
                            button
                        );

                    }


                    renderAnimeHTML(
                        cachedHTML,
                        filter
                    );

                    return;

                }


                /*
                    =================================================
                    LOADING
                    =================================================
                */

                results.setAttribute(
                    "aria-busy",
                    "true"
                );


                results.innerHTML =
                    createSkeletonCards(
                        18
                    );


                updateHeader(
                    filter,
                    0
                );


                try {

                    const response =
                        await fetch(

                            `/dashboard/anime/cards?filter=${
                                encodeURIComponent(
                                    filter
                                )
                            }`,

                            {
                                method:
                                    "GET",

                                headers: {
                                    "Accept":
                                        "text/html"
                                },

                                cache:
                                    "default",

                                signal:
                                    controller.signal
                            }

                        );


                    if (
                        requestID !==
                        animePageState
                            .requestSerial
                    ) {

                        return;

                    }


                    if (
                        !response.ok
                    ) {

                        throw new Error(
                            `Anime request failed: ${response.status}`
                        );

                    }


                    const html =
                        await response.text();


                    if (
                        requestID !==
                        animePageState
                            .requestSerial
                    ) {

                        return;

                    }


                    animeHTMLCache.set(
                        filter,
                        html
                    );


                    renderAnimeHTML(
                        html,
                        filter
                    );


                    console.log(
                        "[MOVIPILOT ANIME]",
                        filter,
                        "loaded:",
                        results.querySelectorAll(
                            ".anime-card"
                        ).length,
                        "items"
                    );

                } catch (
                    error
                ) {

                    if (
                        error.name ===
                        "AbortError"
                    ) {

                        return;

                    }


                    console.error(
                        "[MOVIPILOT ANIME]",
                        error
                    );


                    if (
                        requestID !==
                        animePageState
                            .requestSerial
                    ) {

                        return;

                    }


                    results.innerHTML = `

                        <div
                            class="anime-empty-state"
                        >

                            <span
                                class="anime-empty-kicker"
                            >
                                COLLECTION ERROR
                            </span>

                            <h3>
                                We couldn't load this anime collection.
                            </h3>

                            <p>
                                Please try the category again.
                            </p>

                        </div>

                    `;


                    updateHeader(
                        filter,
                        0
                    );


                    results.setAttribute(
                        "aria-busy",
                        "false"
                    );

                }

            }


            /* =================================================
               FILTER EVENTS
               ================================================= */

            filterButtons.forEach(
                (button) => {

                    button.addEventListener(
                        "click",
                        async () => {

                            const filter =
                                button.dataset
                                    .animeFilter;


                            if (
                                !filter ||
                                !animeFilterTitles[
                                    filter
                                ]
                            ) {

                                return;

                            }


                            setActiveFilter(
                                button
                            );


                            await loadAnimeCards(
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
                            ".anime-explore-button"
                        );


                    if (!button) {

                        return;

                    }


                    const animeID =
                        button.dataset.animeId;


                    const animeType =
                        button.dataset.animeType;


                    if (
                        !animeID ||
                        !animeType
                    ) {

                        return;

                    }


                    /*
                        Do NOT send the user to a route
                        that doesn't exist yet.

                        We expose a clean event for the
                        Anime Details page that we'll connect
                        later.
                    */

                    document.dispatchEvent(

                        new CustomEvent(
                            "movipilot:explore-anime",
                            {
                                detail: {
                                    id:
                                        animeID,

                                    type:
                                        animeType
                                }
                            }
                        )

                    );


                    console.log(
                        "[MOVIPILOT ANIME] Explore:",
                        animeType,
                        animeID
                    );

                }
            );


            /* =================================================
               RESTORE LAST FILTER
               ================================================= */

            let initialFilter =
                animePageState.currentFilter ||
                "all";


            if (
                !animeFilterTitles[
                    initialFilter
                ]
            ) {

                initialFilter =
                    "all";

            }


            const initialButton =
                findFilterButton(
                    initialFilter
                );


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

            await loadAnimeCards(
                initialFilter
            );

        };

})();