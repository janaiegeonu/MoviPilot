/* =========================================================
   MOVIPILOT MOVIES PAGE
   Dynamic Dashboard Page
   ========================================================= */

(() => {

    "use strict";


    console.log(
        "MOVIPILOT MOVIE PAGE JS LOADED"
    );


    /* =====================================================
       GLOBAL MOVIE PAGE CACHE
       ===================================================== */

    /*
        Keep the cache outside initMoviePage().

        This means:

        Movies
            ↓
        Series
            ↓
        Movies again

        can reuse previously loaded movie HTML.
    */

    const movieHTMLCache =
        window.__movipilotMovieHTMLCache ||
        new Map();


    window.__movipilotMovieHTMLCache =
        movieHTMLCache;


    /* =====================================================
       GLOBAL REQUEST STATE
       ===================================================== */

    const moviePageState =
        window.__movipilotMoviePageState ||
        {
            controller: null,
            requestSerial: 0
        };


    window.__movipilotMoviePageState =
        moviePageState;


    /* =====================================================
       FILTER TITLES
       ===================================================== */

    const filterTitles = {

        all:
            "Movies for You",

        new:
            "New Movie Releases",

        upcoming:
            "Upcoming Movies",

        "top-rated":
            "Top Rated Movies",

        popular:
            "Popular Movies",

        action:
            "Action Movies",

        anime:
            "Anime Movies",

        romance:
            "Romance Movies",

        "sci-fi":
            "Science Fiction Movies",

        adventure:
            "Adventure Movies",

        horror:
            "Horror Movies",

        cartoon:
            "Cartoon Movies"

    };


    /* =====================================================
       INITIALIZE MOVIE PAGE
       ===================================================== */

    window.initMoviePage =
        async function () {

            /*
                IMPORTANT:

                Find the Movie page NOW.

                This happens after dashboard.js
                has inserted the Movie HTML.
            */

            const moviePage =
                document.getElementById(
                    "moviePage"
                );


            if (!moviePage) {

                console.warn(
                    "[MOVIPILOT MOVIES] Movie page was not found."
                );

                return;

            }


            /* =================================================
               ELEMENTS
               ================================================= */

            const results =
                moviePage.querySelector(
                    "#movieResults"
                );


            const resultsTitle =
                moviePage.querySelector(
                    "#movieResultsTitle"
                );


            const resultsCount =
                moviePage.querySelector(
                    "#movieResultsCount"
                );


            const filterButtons =
                Array.from(
                    moviePage.querySelectorAll(
                        ".movie-filter-button"
                    )
                );


            if (!results) {

                console.error(
                    "[MOVIPILOT MOVIES] #movieResults not found."
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
               UPDATE HEADER
               ================================================= */

            function updateResultsHeader(
                filter,
                count
            ) {

                if (
                    resultsTitle
                ) {

                    resultsTitle.textContent =
                        filterTitles[filter] ||
                        "Movies for You";

                }


                if (
                    resultsCount
                ) {

                    resultsCount.textContent =
                        `${count} MOVIES`;

                }

            }


            /* =================================================
               BUSY STATE
               ================================================= */

            function setBusy(
                state
            ) {

                results.setAttribute(
                    "aria-busy",
                    String(state)
                );

            }


            /* =================================================
               SKELETON LOADER
               ================================================= */

            function renderSkeletons(
                count = 24
            ) {

                const skeletonCards =
                    Array.from(
                        {
                            length:
                                count
                        },
                        () => {

                            return `

                                <article
                                    class="movie-skeleton-card"
                                    aria-hidden="true"
                                >

                                    <div
                                        class="movie-skeleton-poster"
                                    ></div>

                                    <div
                                        class="movie-skeleton-line"
                                    ></div>

                                    <div
                                        class="movie-skeleton-line short"
                                    ></div>

                                </article>

                            `;

                        }
                    ).join("");


                results.innerHTML = `

                    <div
                        class="movie-skeleton-grid"
                    >

                        ${skeletonCards}

                    </div>

                `;

            }


            /* =================================================
               LOADING STATE
               ================================================= */

            function renderLoadingState() {

                results.innerHTML = `

                    <div
                        class="movie-loading-state"
                    >

                        <div
                            class="movie-loading-spinner"
                        ></div>

                        <span>
                            Discovering movies...
                        </span>

                    </div>

                `;

            }


            /* =================================================
               IMAGE INITIALIZATION
               ================================================= */

            function initializeMovieImages() {

                const images =
                    results.querySelectorAll(
                        ".movie-card-poster"
                    );


                images.forEach(
                    (image) => {

                        const media =
                            image.closest(
                                ".movie-card-media"
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

                                /*
                                    Treat broken images as
                                    finished loading so one
                                    bad poster does not leave
                                    a spinner forever.
                                */

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
               RENDER MOVIE HTML
               ================================================= */

            function renderMovieHTML(
                html,
                filter
            ) {

                results.innerHTML =
                    html;


                const movieCards =
                    results.querySelectorAll(
                        ".movie-card"
                    );


                const count =
                    movieCards.length;


                updateResultsHeader(
                    filter,
                    count
                );


                initializeMovieImages();

            }


            /* =================================================
               LOAD MOVIES
               ================================================= */

            async function loadMovies(
                filter
            ) {

                /*
                    Every request gets a unique ID.

                    This prevents an older request from
                    replacing newer filter results.
                */

                const requestID =
                    ++moviePageState.requestSerial;


                /*
                    Cancel previous request.
                */

                if (
                    moviePageState.controller
                ) {

                    moviePageState
                        .controller
                        .abort();

                }


                /*
                    New request controller.
                */

                const controller =
                    new AbortController();


                moviePageState.controller =
                    controller;


                /*
                    Check browser cache first.
                */

                const cachedHTML =
                    movieHTMLCache.get(
                        filter
                    );


                if (
                    cachedHTML
                ) {

                    /*
                        Make selected filter active
                        before displaying cached data.
                    */

                    const selectedButton =
                        filterButtons.find(
                            (button) =>
                                button.dataset
                                    .movieFilter ===
                                filter
                        );


                    if (
                        selectedButton
                    ) {

                        setActiveFilter(
                            selectedButton
                        );

                    }


                    renderMovieHTML(
                        cachedHTML,
                        filter
                    );


                    setBusy(
                        false
                    );


                    return;

                }


                /* =================================================
                   NETWORK LOADING STATE
                   ================================================= */

                setBusy(
                    true
                );


                renderSkeletons(
                    24
                );


                updateResultsHeader(
                    filter,
                    0
                );


                try {

                    const response =
                        await fetch(

                            `/movies/cards?filter=${
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
                                    "X-Requested-With":
                                        "XMLHttpRequest"
                                }
                            }

                        );


                    /*
                        Ignore stale requests.
                    */

                    if (
                        requestID !==
                        moviePageState
                            .requestSerial
                    ) {

                        return;

                    }


                    if (
                        !response.ok
                    ) {

                        throw new Error(
                            `Movie request failed: ${response.status}`
                        );

                    }


                    const html =
                        await response.text();


                    /*
                        Check again.

                        Another filter may have
                        been selected while the HTML
                        was being returned.
                    */

                    if (
                        requestID !==
                        moviePageState
                            .requestSerial
                    ) {

                        return;

                    }


                    /*
                        Save successful response.
                    */

                    movieHTMLCache.set(
                        filter,
                        html
                    );


                    /*
                        Render cards.
                    */

                    renderMovieHTML(
                        html,
                        filter
                    );


                    setBusy(
                        false
                    );


                    console.log(
                        "[MOVIPILOT MOVIES]",
                        `${filter} loaded:`,
                        results.querySelectorAll(
                            ".movie-card"
                        ).length,
                        "movies"
                    );

                } catch (
                    error
                ) {

                    /*
                        Abort is expected when
                        changing filters.
                    */

                    if (
                        error.name ===
                        "AbortError"
                    ) {

                        return;

                    }


                    console.error(
                        "[MOVIPILOT MOVIES]",
                        error
                    );


                    /*
                        Don't allow an older
                        request to display its
                        error over a newer page.
                    */

                    if (
                        requestID !==
                        moviePageState
                            .requestSerial
                    ) {

                        return;

                    }


                    results.innerHTML = `

                        <div
                            class="movie-empty-state"
                        >

                            <span
                                class="movie-empty-kicker"
                            >
                                CONNECTION ISSUE
                            </span>

                            <h3>
                                We couldn't load the movies right now.
                            </h3>

                            <p>
                                Please try the filter again.
                            </p>

                        </div>

                    `;


                    updateResultsHeader(
                        filter,
                        0
                    );


                    setBusy(
                        false
                    );

                }

            }


            /* =================================================
               FILTER BUTTON EVENTS
               ================================================= */

            filterButtons.forEach(
                (button) => {

                    button.addEventListener(
                        "click",
                        async () => {

                            const filter =
                                button.dataset
                                    .movieFilter;


                            if (!filter) {

                                return;

                            }


                            /*
                                Change visual state
                                immediately.
                            */

                            setActiveFilter(
                                button
                            );


                            /*
                                Load requested
                                collection.
                            */

                            await loadMovies(
                                filter
                            );

                        }
                    );

                }
            );


            /* =================================================
               MOVIE EXPLORE BUTTON
               ================================================= */

            results.addEventListener(
                "click",
                (event) => {

                    const button =
                        event.target.closest(
                            ".movie-explore-button"
                        );


                    if (!button) {

                        return;

                    }


                    const movieID =
                        button.dataset.movieId;


                    if (!movieID) {

                        return;

                    }


                    window.location.href =
                        `/movies?id=${
                            encodeURIComponent(
                                movieID
                            )
                        }`;

                }
            );


            /* =================================================
               INITIAL FILTER
               ================================================= */

            const initialFilterButton =
                moviePage.querySelector(
                    ".movie-filter-button.is-active"
                );


            const initialFilter =
                initialFilterButton
                    ?.dataset
                    .movieFilter ||
                "all";


            /*
                Make absolutely sure the
                initial button is active.
            */

            if (
                initialFilterButton
            ) {

                setActiveFilter(
                    initialFilterButton
                );

            }


            /* =================================================
               FIRST MOVIE LOAD
               ================================================= */

            renderLoadingState();


            await loadMovies(
                initialFilter
            );

        };


})();