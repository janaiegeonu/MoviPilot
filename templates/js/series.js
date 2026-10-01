/* =========================================================
   MOVIPILOT SERIES PAGE JAVASCRIPT
   ========================================================= */

(() => {

    "use strict";


    /* =====================================================
       DASHBOARD MAIN
       ===================================================== */

    const dashboardMain =
        document.getElementById(
            "dashboardMain"
        );


    if (!dashboardMain) {
        return;
    }



    /* =====================================================
       IMPORTANT:

       Save the ORIGINAL HOME markup before Series ever
       replaces dashboardMain.

       This is what fixes the Home -> Series -> Home problem.
       ===================================================== */

    const homeMarkup =
        dashboardMain.innerHTML;



    /* =====================================================
       STATE
       ===================================================== */

    let currentDashboardView =
        "home";


    let seriesRequestController =
        null;


    let navigationLocked =
        false;



    /* =====================================================
       PAGE LABELS
       ===================================================== */

    const seriesFilterInfo = {

        all: {
            title: "Series for You"
        },

        new: {
            title: "New Series"
        },

        upcoming: {
            title: "Upcoming Series"
        },

        "top-rated": {
            title: "Top Rated Series"
        },

        horror: {
            title: "Horror Series"
        },

        anime: {
            title: "Anime Series"
        },

        romance: {
            title: "Romance Series"
        },

        action: {
            title: "Action Series"
        }

    };



    /* =====================================================
       UTILITY
       ===================================================== */

    function sleep(
        milliseconds
    ) {

        return new Promise(
            resolve => {

                window.setTimeout(
                    resolve,
                    milliseconds
                );

            }
        );

    }



    /* =====================================================
       ACTIVE NAVBAR BUTTON
       ===================================================== */

    function setActiveNavigation(
        page
    ) {

        document
            .querySelectorAll(
                ".nav-link[data-page]"
            )
            .forEach(button => {

                button.classList.toggle(
                    "active",
                    button.dataset.page === page
                );

            });

    }



    /* =====================================================
       ENTER ANIMATION
       ===================================================== */

    function playEnterAnimation() {

        dashboardMain.classList.remove(
            "series-nav-entering"
        );


        void dashboardMain.offsetWidth;


        dashboardMain.classList.add(
            "series-nav-entering"
        );


        window.setTimeout(() => {

            dashboardMain.classList.remove(
                "series-nav-entering"
            );

        }, 300);

    }



    /* =====================================================
       PAGE SWITCH LOADER
       ===================================================== */

    function showPageLoader() {

        dashboardMain.innerHTML = `

            <div class="series-page-switch-loader">

                <div
                    class="series-page-switch-loader-spinner"
                ></div>

                <span>
                    LOADING MOVIPILOT
                </span>

            </div>

        `;

    }



    /* =====================================================
       GO HOME

       No network request.

       We restore the original dashboard HTML that existed
       when the page first loaded.
       ===================================================== */

    async function showHomePage() {

        if (
            currentDashboardView ===
            "home"
        ) {

            return;

        }


        navigationLocked =
            true;


        /*
            Stop any active Series request.
        */

        if (seriesRequestController) {

            seriesRequestController.abort();

            seriesRequestController =
                null;

        }


        /*
            Quick dissolve.
        */

        dashboardMain.classList.add(
            "series-nav-leaving"
        );


        await sleep(140);


        /*
            Restore original Home dashboard.
        */

        dashboardMain.innerHTML =
            homeMarkup;


        /*
            Reset scroll position.
        */

        dashboardMain.scrollTop =
            0;


        currentDashboardView =
            "home";


        setActiveNavigation(
            "home"
        );


        dashboardMain.classList.remove(
            "series-nav-leaving"
        );


        playEnterAnimation();


        navigationLocked =
            false;

    }



    /* =====================================================
       SHOW SERIES PAGE
       ===================================================== */

    async function showSeriesPage() {

        if (
            currentDashboardView ===
            "series"
        ) {

            /*
                Already on Series.
                Just return to the top.
            */

            window.scrollTo({
                top: 0,
                behavior: "smooth"
            });

            return;

        }


        navigationLocked =
            true;


        /*
            Request Series shell immediately.

            This request happens while the old dashboard
            is dissolving.
        */

        if (seriesRequestController) {

            seriesRequestController.abort();

        }


        seriesRequestController =
            new AbortController();


        const signal =
            seriesRequestController.signal;


        const seriesPagePromise =
            fetch(
                "/dashboard/series",
                {
                    method: "GET",

                    headers: {
                        "Accept": "text/html"
                    },

                    cache: "no-store",

                    signal: signal
                }
            );



        /* =================================================
           QUICK DISSOLVE
           ================================================= */

        dashboardMain.classList.add(
            "series-nav-leaving"
        );


        await sleep(140);



        /*
            While the shell is arriving, display a loader
            rather than leaving a blank page.
        */

        showPageLoader();


        try {

            const response =
                await seriesPagePromise;


            if (!response.ok) {

                throw new Error(
                    `Series page returned ${response.status}`
                );

            }


            const html =
                await response.text();


            /*
                Insert the Series shell.
            */

            dashboardMain.innerHTML =
                html;


            dashboardMain.scrollTop =
                0;


            currentDashboardView =
                "series";


            setActiveNavigation(
                "tv"
            );


            /*
                Finish the page transition.
            */

            dashboardMain.classList.remove(
                "series-nav-leaving"
            );


            playEnterAnimation();



            /*
                Now fetch the actual cards.

                This means the hero + filter UI becomes visible
                immediately while the card collection loads.
            */

            await loadSeriesCards(
                "all",
                true
            );


        } catch (error) {

            /*
                Ignore a request deliberately cancelled
                because the user clicked Home.
            */

            if (
                error.name ===
                "AbortError"
            ) {

                navigationLocked =
                    false;

                return;

            }


            console.error(
                "MoviPilot Series page error:",
                error
            );


            dashboardMain.innerHTML = `

                <section class="series-empty-state">

                    <span class="series-empty-kicker">
                        SERIES PAGE ERROR
                    </span>

                    <h3>
                        The Series library could not be loaded.
                    </h3>

                    <p>
                        Please refresh the dashboard and try again.
                    </p>

                </section>

            `;


            dashboardMain.classList.remove(
                "series-nav-leaving"
            );


            playEnterAnimation();

        }


        navigationLocked =
            false;

    }



    /* =====================================================
       NAVBAR HANDLERS

       IMPORTANT:
       We ONLY take control of Home + Series.

       Movies / Anime remain owned by your existing
       dashboard.js so this new file doesn't break them.
       ===================================================== */

    document
        .querySelectorAll(
            ".nav-link[data-page]"
        )
        .forEach(button => {

            button.addEventListener(
                "click",
                event => {

                    const page =
                        button.dataset.page;


                    if (page === "tv") {

                        event.preventDefault();

                        event.stopImmediatePropagation();


                        if (
                            navigationLocked
                        ) {

                            return;

                        }


                        showSeriesPage();


                        return;

                    }


                    if (page === "home") {

                        event.preventDefault();

                        event.stopImmediatePropagation();


                        if (
                            navigationLocked
                        ) {

                            return;

                        }


                        showHomePage();

                    }

                    /*
                        Nothing happens for Movies / Anime
                        here. Their existing dashboard.js code
                        remains untouched.
                    */

                }
            );

        });



    /* =====================================================
       FILTER BUTTON CLICK
       ===================================================== */

    document.addEventListener(
        "click",
        event => {

            const filterButton =
                event.target.closest(
                    "[data-series-filter]"
                );


            if (!filterButton) {
                return;
            }


            /*
                Filter buttons only exist on Series.
            */

            if (
                !dashboardMain.querySelector(
                    "#seriesPage"
                )
            ) {

                return;

            }


            const filter =
                filterButton.dataset.seriesFilter;


            if (
                !seriesFilterInfo[filter]
            ) {

                return;

            }


            /*
                Active filter.
            */

            document
                .querySelectorAll(
                    ".series-filter-button"
                )
                .forEach(button => {

                    button.classList.toggle(
                        "is-active",
                        button === filterButton
                    );

                });


            /*
                Update heading instantly.
            */

            const titleElement =
                document.getElementById(
                    "seriesResultsTitle"
                );


            if (titleElement) {

                titleElement.textContent =
                    seriesFilterInfo[filter].title;

            }


            loadSeriesCards(
                filter,
                false
            );

        }
    );



    /* =====================================================
       CARD SKELETON GENERATOR
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

                <div class="series-skeleton-card">

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

            <div class="series-skeleton-grid">

                ${cards.join("")}

            </div>

        `;

    }



    /* =====================================================
       LOAD SERIES CARDS
       ===================================================== */

    async function loadSeriesCards(
        filter,
        initialLoad
    ) {

        const results =
            document.getElementById(
                "seriesResults"
            );


        if (!results) {
            return;
        }


        /*
            Cancel previous filter request.
        */

        if (seriesRequestController) {

            seriesRequestController.abort();

        }


        seriesRequestController =
            new AbortController();


        const signal =
            seriesRequestController.signal;


        /*
            Show skeleton cards immediately.

            This is important:
            the user never sees an empty blank area while
            switching filters.
        */

        results.innerHTML =
            createSkeletonCards(
                initialLoad
                    ? 18
                    : 18
            );


        results.classList.add(
            "is-switching"
        );


        results.setAttribute(
            "aria-busy",
            "true"
        );


        try {

            const response =
                await fetch(
                    `/dashboard/series/cards?filter=${encodeURIComponent(filter)}`,
                    {
                        method: "GET",

                        headers: {
                            "Accept": "text/html"
                        },

                        cache: "no-store",

                        signal: signal
                    }
                );


            if (!response.ok) {

                throw new Error(
                    `Series cards returned ${response.status}`
                );

            }


            const html =
                await response.text();


            /*
                Only the result collection changes.
            */

            results.innerHTML =
                html;


            results.classList.remove(
                "is-switching"
            );


            results.setAttribute(
                "aria-busy",
                "false"
            );


            /*
                Update count from the number of actual cards
                that the server successfully produced.
            */

            const cardCount =
                results.querySelectorAll(
                    ".series-card"
                ).length;


            const countElement =
                document.getElementById(
                    "seriesResultsCount"
                );


            if (countElement) {

                countElement.textContent =
                    `${cardCount} SERIES`;

            }


            /*
                If there are cards, scroll the catalog to its
                beginning without moving the whole dashboard
                aggressively.
            */

            if (!initialLoad) {

                results.scrollIntoView({
                    behavior: "smooth",
                    block: "start"
                });

            }

        } catch (error) {

            if (
                error.name ===
                "AbortError"
            ) {

                return;

            }


            console.error(
                "MoviPilot Series cards error:",
                error
            );


            results.innerHTML = `

                <div class="series-empty-state">

                    <span class="series-empty-kicker">
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


            results.classList.remove(
                "is-switching"
            );


            results.setAttribute(
                "aria-busy",
                "false"
            );

        }

    }



    /* =====================================================
       IMAGE LOADED
       ===================================================== */

    document.addEventListener(
        "load",
        event => {

            const image =
                event.target.closest(
                    ".series-card-poster"
                );


            if (!image) {
                return;
            }


            const media =
                image.closest(
                    ".series-card-media"
                );


            if (!media) {
                return;
            }


            media.classList.add(
                "is-loaded"
            );

        },
        true
    );



    /* =====================================================
       IMAGE ERROR FALLBACK
       ===================================================== */

    document.addEventListener(
        "error",
        event => {

            const image =
                event.target.closest(
                    ".series-card-poster"
                );


            if (!image) {
                return;
            }


            const media =
                image.closest(
                    ".series-card-media"
                );


            if (!media) {
                return;
            }


            image.style.display =
                "none";


            media.classList.add(
                "is-loaded"
            );

        },
        true
    );



    /* =====================================================
       EXPLORE BUTTON PREPARATION

       The card now has a real series ID attached to it.

       We don't force a nonexistent details route yet.
       This keeps the button ready for the Series Details
       page we build next.
       ===================================================== */

    document.addEventListener(
        "click",
        event => {

            const exploreButton =
                event.target.closest(
                    ".series-explore-button"
                );


            if (!exploreButton) {
                return;
            }


            const seriesID =
                exploreButton.dataset.seriesId;


            if (!seriesID) {
                return;
            }


            /*
                Future Series Details navigation can listen
                for this event.

                Example future usage:

                document.addEventListener(
                    "movipilot:explore-series",
                    ...
                );
            */

            document.dispatchEvent(
                new CustomEvent(
                    "movipilot:explore-series",
                    {
                        detail: {
                            id: seriesID
                        }
                    }
                )
            );

        }
    );

})();