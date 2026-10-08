/* =========================================================
   MOVIPILOT SIDEBAR
   ========================================================= */

console.log(
    "MOVIPILOT SIDEBAR JS LOADED"
);


/* =========================================================
   ELEMENTS
   ========================================================= */

const sidebar =
    document.getElementById(
        "dashboardSidebar"
    );


const sidebarToggle =
    document.getElementById(
        "sidebarToggle"
    );


const mobileMenuButton =
    document.getElementById(
        "mobileMenuButton"
    );


const sidebarItems =
    document.querySelectorAll(
        ".sidebar-item[data-sidebar-action]"
    );


/* =========================================================
   SAFETY CHECK
   ========================================================= */

if (
    sidebar &&
    sidebarToggle &&
    mobileMenuButton
) {


    /* =====================================================
       MOBILE CHECK
       ===================================================== */

    function isMobile() {

        return window.innerWidth <= 720;

    }


    /* =====================================================
       DESKTOP COLLAPSE
       ===================================================== */
function setSidebarCollapsed(
    collapsed
) {

    if (isMobile()) {

        return;

    }


    sidebar.classList.toggle(
        "collapsed",
        collapsed
    );


    sidebarToggle.setAttribute(
        "aria-expanded",
        String(!collapsed)
    );


    sidebarToggle.setAttribute(
        "aria-label",
        collapsed
            ? "Expand sidebar"
            : "Collapse sidebar"
    );


    localStorage.setItem(
        "movipilotSidebarCollapsed",
        String(collapsed)
    );

}

    /* =====================================================
       RESTORE DESKTOP SIDEBAR STATE
       ===================================================== */

    const savedSidebarState =
        localStorage.getItem(
            "movipilotSidebarCollapsed"
        );


    if (
        savedSidebarState === "true" &&
        !isMobile()
    ) {

        sidebar.classList.add(
            "collapsed"
        );


        sidebarToggle.setAttribute(
            "aria-expanded",
            "false"
        );


        sidebarToggle.setAttribute(
            "aria-label",
            "Expand sidebar"
        );

    }


    /* =====================================================
       OPEN MOBILE SIDEBAR
       ===================================================== */

    function openMobileSidebar() {

        if (!isMobile()) {

            return;

        }


        sidebar.classList.add(
            "mobile-open"
        );


        mobileMenuButton.setAttribute(
            "aria-expanded",
            "true"
        );


        document.body.classList.add(
            "sidebar-open"
        );

    }


    /* =====================================================
       CLOSE MOBILE SIDEBAR
       ===================================================== */

    function closeMobileSidebar() {

        sidebar.classList.remove(
            "mobile-open"
        );


        mobileMenuButton.setAttribute(
            "aria-expanded",
            "false"
        );


        document.body.classList.remove(
            "sidebar-open"
        );

    }


    /* =====================================================
       SIDEBAR TOGGLE
       ===================================================== */

    sidebarToggle.addEventListener(
        "click",
        (event) => {

            event.stopPropagation();


            /* ---------------------------------------------
               MOBILE
               --------------------------------------------- */

            if (isMobile()) {

                closeMobileSidebar();

                return;

            }


            /* ---------------------------------------------
               DESKTOP
               --------------------------------------------- */

            const shouldCollapse =
                !sidebar.classList.contains(
                    "collapsed"
                );


            setSidebarCollapsed(
                shouldCollapse
            );

        }
    );


    /* =====================================================
       MOBILE HAMBURGER
       ===================================================== */

    mobileMenuButton.addEventListener(
        "click",
        (event) => {

            event.stopPropagation();


            if (
                sidebar.classList.contains(
                    "mobile-open"
                )
            ) {

                closeMobileSidebar();

            } else {

                openMobileSidebar();

            }

        }
    );


    /* =====================================================
       CLOSE MOBILE SIDEBAR
       WHEN CLICKING OUTSIDE
       ===================================================== */

    document.addEventListener(
        "click",
        (event) => {

            if (!isMobile()) {

                return;

            }


            if (
                !sidebar.classList.contains(
                    "mobile-open"
                )
            ) {

                return;

            }


            const clickedInsideSidebar =
                sidebar.contains(
                    event.target
                );


            const clickedHamburger =
                mobileMenuButton.contains(
                    event.target
                );


            if (
                !clickedInsideSidebar &&
                !clickedHamburger
            ) {

                closeMobileSidebar();

            }

        }
    );


    /* =====================================================
       ESCAPE KEY
       ===================================================== */

    document.addEventListener(
        "keydown",
        (event) => {

            if (
                event.key === "Escape" &&
                isMobile() &&
                sidebar.classList.contains(
                    "mobile-open"
                )
            ) {

                closeMobileSidebar();

                mobileMenuButton.focus();

            }

        }
    );


    /* =====================================================
       SIDEBAR FEATURE BUTTONS
       ===================================================== */

    sidebarItems.forEach(
        (item) => {

            item.addEventListener(
                "click",
                () => {

                    const action =
                        item.dataset.sidebarAction;


                    const label =
                        item.dataset.sidebarLabel;


                    /* -------------------------------------
                       ACTIVE STATE
                       ------------------------------------- */

                    sidebarItems.forEach(
                        (sidebarItem) => {

                            sidebarItem.classList.remove(
                                "is-selected"
                            );


                            sidebarItem.removeAttribute(
                                "aria-current"
                            );

                        }
                    );


                    item.classList.add(
                        "is-selected"
                    );


                    item.setAttribute(
                        "aria-current",
                        "page"
                    );


                    /* -------------------------------------
                       CLOSE MOBILE SIDEBAR
                       ------------------------------------- */

                    if (isMobile()) {

                        closeMobileSidebar();

                    }


                    /* -------------------------------------
                       FUTURE PAGE HOOK
                       -------------------------------------

                       We intentionally do NOT redirect
                       anywhere yet because these pages
                       have not been created.

                       Later you can connect:
                         watchlist
                         history
                         ratings
                         for-you
                         mood
                         collections

                       to your dashboard page loader.
                       ------------------------------------- */

                    window.dispatchEvent(
                        new CustomEvent(
                            "movipilotSidebarAction",
                            {
                                detail: {
                                    action: action,
                                    label: label
                                }
                            }
                        )
                    );


                    console.log(
                        "MoviPilot sidebar action:",
                        action
                    );

                }
            );

        }
    );


    /* =====================================================
       LISTEN FOR FUTURE SIDEBAR PAGE EVENTS
       ===================================================== */

    window.addEventListener(
        "movipilotSidebarAction",
        (event) => {

            console.log(
                "Sidebar feature selected:",
                event.detail
            );

        }
    );


    /* =====================================================
       HANDLE SCREEN SIZE CHANGES
       ===================================================== */

    window.addEventListener(
        "resize",
        () => {

            if (isMobile()) {

                sidebar.classList.remove(
                    "collapsed"
                );

                return;

            }


            closeMobileSidebar();


            const savedState =
                localStorage.getItem(
                    "movipilotSidebarCollapsed"
                );


            if (
                savedState === "true"
            ) {

                sidebar.classList.add(
                    "collapsed"
                );

            } else {

                sidebar.classList.remove(
                    "collapsed"
                );

            }

        }
    );

}

/* =========================================================
   MAIN NAVIGATION
   ========================================================= */

const navigationButtons =
    document.querySelectorAll(
        ".nav-link"
    );


const dashboardMain =
    document.getElementById(
        "dashboardMain"
    );


/* =========================================================
   SAFETY CHECK
   ========================================================= */

if (!dashboardMain) {

    console.error(
        "[MOVIPILOT] #dashboardMain was not found."
    );

}


/* =========================================================
   CREATE PERMANENT HOME VIEW
   ---------------------------------------------------------
   IMPORTANT:

   We take the Home content that already exists
   inside dashboardMain and place it inside a
   permanent Home wrapper.

   Those DOM nodes are NEVER destroyed.
   ========================================================= */

const dashboardHomeView =
    document.createElement(
        "div"
    );


dashboardHomeView.id =
    "dashboardHomeView";


dashboardHomeView.className =
    "dashboard-home-view";


/*
    Move the existing Home elements into
    dashboardHomeView.

    This preserves the original DOM nodes
    and therefore preserves their listeners.
*/

while (
    dashboardMain.firstChild
) {

    dashboardHomeView.appendChild(
        dashboardMain.firstChild
    );

}


/*
    Put Home back inside dashboardMain.
*/

dashboardMain.appendChild(
    dashboardHomeView
);


/* =========================================================
   CREATE DYNAMIC PAGE VIEW
   ---------------------------------------------------------
   Movies / Series / Anime will live here.

   Home never goes inside this element.
   ========================================================= */

const dashboardDynamicPage =
    document.createElement(
        "div"
    );


dashboardDynamicPage.id =
    "dashboardDynamicPage";


dashboardDynamicPage.className =
    "dashboard-dynamic-page";


dashboardDynamicPage.hidden =
    true;


dashboardMain.appendChild(
    dashboardDynamicPage
);


/* =========================================================
   DASHBOARD ROUTES
   ========================================================= */

const dashboardPageRoutes = {

    home:
        "/dashboard",

    tv:
        "/series",

    movies:
        "/movies",

    anime:
        "/anime"

};


/* =========================================================
   PAGE STATE
   ========================================================= */

let currentDashboardPage =
    "home";


let currentPageRequest =
    null;


let navigationSerial =
    0;


/*
    Used when returning Home.
*/

let homeScrollPosition =
    0;


/* =========================================================
   ACTIVE NAVIGATION
   ========================================================= */

function setActiveNavigation(
    activePage
) {

    navigationButtons.forEach(
        (button) => {

            button.classList.toggle(
                "active",
                button.dataset.page ===
                activePage
            );

        }
    );

}


/* =========================================================
   PAUSE HOME
   ========================================================= */

function pauseDashboardHomePage() {

    /*
        Close Home hero trailer.
    */

    if (
        typeof closeHeroTrailer ===
        "function"
    ) {

        closeHeroTrailer(
            false
        );

    }


    /*
        Close movie-row trailer.
    */

    if (
        typeof closeMovieTrailer ===
        "function"
    ) {

        closeMovieTrailer(
            false
        );

    }


    /*
        Stop hero autoplay.
    */

    if (
        typeof stopHeroAutoPlay ===
        "function"
    ) {

        stopHeroAutoPlay();

    }


    /*
        Pause content-row autoplay.
    */

    dashboardHomeView
        .querySelectorAll(
            "[data-section-carousel]"
        )
        .forEach(
            (section) => {

                section.dispatchEvent(
                    new Event(
                        "mouseenter"
                    )
                );

            }
        );

}


/* =========================================================
   RESUME HOME
   ========================================================= */

function resumeDashboardHomePage() {

    /*
        Restart Home hero.
    */

    if (
        typeof startHeroAutoPlay ===
        "function"
    ) {

        startHeroAutoPlay();

    }


    /*
        Restart content-row autoplay.

        Mouseleave tells the existing row
        system that the pointer is no longer
        inside the section.
    */

    dashboardHomeView
        .querySelectorAll(
            "[data-section-carousel]"
        )
        .forEach(
            (section) => {

                section.dispatchEvent(
                    new Event(
                        "mouseleave"
                    )
                );

            }
        );

}


/* =========================================================
   SHOW HOME
   ========================================================= */

function showDashboardHome() {

    /*
        Cancel any dynamic page request.
    */

    if (
        currentPageRequest
    ) {

        currentPageRequest.abort();

        currentPageRequest =
            null;

    }


    /*
        Hide dynamic content.
    */

    dashboardDynamicPage.hidden =
        true;


    /*
        Clear dynamic page.

        Home is NOT affected.
    */

    dashboardDynamicPage.replaceChildren();


    /*
        Show Home.
    */

    dashboardHomeView.hidden =
        false;


    /*
        Update state.
    */

    currentDashboardPage =
        "home";


    setActiveNavigation(
        "home"
    );


    /*
        Restore scroll.
    */

    window.scrollTo(
        0,
        homeScrollPosition
    );


    /*
        Restart Home animations.
    */

    resumeDashboardHomePage();


    console.log(
        "[MOVIPILOT] Home displayed."
    );

}


/* =========================================================
   HIDE HOME
   ========================================================= */

function hideDashboardHome() {

    /*
        Remember where the user was.
    */

    homeScrollPosition =
        window.scrollY;


    /*
        Stop Home animations.
    */

    pauseDashboardHomePage();


    /*
        Hide Home.

        IMPORTANT:

        The DOM remains alive.
    */

    dashboardHomeView.hidden =
        true;

}


/* =========================================================
   INITIALIZE PAGE-SPECIFIC JAVASCRIPT
   ========================================================= */

async function initializeDashboardPage(
    page
) {

    /*
        MOVIES
    */

    if (
        page === "movies" &&
        typeof window.initMoviePage ===
        "function"
    ) {

        await window.initMoviePage();

        return;

    }


    /*
        SERIES
    */

    if (
        page === "tv" &&
        typeof window.initSeriesPage ===
        "function"
    ) {

        await window.initSeriesPage();

        return;

    }


    /*
        ANIME
    */

    if (
        page === "anime" &&
        typeof window.initAnimePage ===
        "function"
    ) {

        await window.initAnimePage();

        return;

    }

}


/* =========================================================
   LOAD PAGE HTML
   ========================================================= */

async function loadDashboardHTML(
    page,
    url,
    controller,
    requestID
) {

    try {

        /*
            Show dynamic area.
        */

        dashboardDynamicPage.hidden =
            false;


        /*
            Show lightweight loader.
        */

        dashboardDynamicPage.innerHTML = `

            <div class="dashboard-page-loading">

                <div
                    class="dashboard-page-loading-spinner"
                ></div>

                <span>
                    Loading MoviPilot...
                </span>

            </div>

        `;


        /*
            Ask Go for the page shell.
        */

        const response =
            await fetch(
                url,
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


        if (!response.ok) {

            throw new Error(
                `Page request failed: ${response.status}`
            );

        }


        /*
            Read HTML.
        */

        const html =
            await response.text();


        /*
            Ignore stale responses.
        */

        if (
            requestID !==
            navigationSerial
        ) {

            return;

        }


        if (
            controller !==
            currentPageRequest
        ) {

            return;

        }


        /*
            IMPORTANT:

            Only the dynamic area changes.
            Home remains untouched.
        */

        dashboardDynamicPage.innerHTML =
            html;


        /*
            Start the page-specific logic.
        */

        await initializeDashboardPage(
            page
        );


        /*
            One final stale-request check.
        */

        if (
            requestID !==
            navigationSerial
        ) {

            return;

        }


        console.log(
            "[MOVIPILOT] Loaded:",
            page
        );

    } catch (error) {

        /*
            Aborted requests are normal.
        */

        if (
            error.name ===
            "AbortError"
        ) {

            return;

        }


        /*
            Ignore errors from old requests.
        */

        if (
            requestID !==
            navigationSerial
        ) {

            return;

        }


        console.error(
            "[MOVIPILOT PAGE LOAD]",
            error
        );


        dashboardDynamicPage.innerHTML = `

            <div class="dashboard-page-loading">

                <strong>
                    We couldn't load this page.
                </strong>

                <span>
                    Please try again.
                </span>

            </div>

        `;

    }

}


/* =========================================================
   LOAD DASHBOARD PAGE
   ========================================================= */

async function loadDashboardPage(
    page
) {

    if (!page) {

        return;

    }


    /*
        Prevent unnecessary reload.
    */

    if (
        page ===
        currentDashboardPage
    ) {

        return;

    }


    /*
        Every click gets a unique number.
    */

    navigationSerial++;

    const requestID =
        navigationSerial;


    /*
        Cancel previous request.
    */

    if (
        currentPageRequest
    ) {

        currentPageRequest.abort();

        currentPageRequest =
            null;

    }


    /* =====================================================
       HOME
       ===================================================== */

    if (
        page ===
        "home"
    ) {

        /*
            Home is local.

            No /dashboard request.
        */

        showDashboardHome();

        return;

    }


    /* =====================================================
       LEAVING HOME
       ===================================================== */

    if (
        currentDashboardPage ===
        "home"
    ) {

        hideDashboardHome();

    }


    /*
        Update current page.
    */

    currentDashboardPage =
        page;


    setActiveNavigation(
        page
    );


    /*
        Start selected page at top.
    */

    window.scrollTo(
        0,
        0
    );


    /*
        Remove previous dynamic page.
    */

    dashboardDynamicPage.replaceChildren();


    /*
        Create request controller.
    */

    currentPageRequest =
        new AbortController();


    const controller =
        currentPageRequest;


    /* =====================================================
       MOVIES
       ===================================================== */

    if (
        page === "movies"
    ) {

        await loadDashboardHTML(
            page,
            dashboardPageRoutes.movies,
            controller,
            requestID
        );

        return;

    }


    /* =====================================================
       SERIES
       ===================================================== */

    if (
        page === "tv"
    ) {

        await loadDashboardHTML(
            page,
            dashboardPageRoutes.tv,
            controller,
            requestID
        );

        return;

    }


    /* =====================================================
       ANIME
       ===================================================== */

    if (
        page === "anime"
    ) {

        await loadDashboardHTML(
            page,
            dashboardPageRoutes.anime,
            controller,
            requestID
        );

        return;

    }

}


/* =========================================================
   NAVIGATION BUTTON EVENTS
   ========================================================= */

navigationButtons.forEach(
    (button) => {

        button.addEventListener(
            "click",
            async () => {

                const page =
                    button.dataset.page;


                if (!page) {

                    return;

                }


                setActiveNavigation(
                    page
                );


                console.log(
                    "[MOVIPILOT] Selected:",
                    page
                );


                await loadDashboardPage(
                    page
                );

            }
        );

    }
);

/* =========================================================
   SEARCH
   ========================================================= */

const searchInput =
    document.getElementById(
        "dashboardSearch"
    );


const searchButton =
    document.getElementById(
        "searchButton"
    );


function performSearch() {

    const query =
        searchInput.value.trim();


    if (!query) {

        searchInput.focus();

        return;

    }


    console.log(
        "Searching for:",
        query
    );


    /*
        Later connect to your Go backend:

        window.location.href =
            "/search?q=" +
            encodeURIComponent(query);
    */

}


searchButton.addEventListener(
    "click",
    performSearch
);


searchInput.addEventListener(
    "keydown",
    (event) => {

        if (event.key === "Enter") {

            performSearch();

        }

    }
);


/* =========================================================
   PROFILE
   ========================================================= */

const profileButton =
    document.getElementById(
        "profileButton"
    );


profileButton.addEventListener(
    "click",
    () => {

        console.log(
            "Profile clicked"
        );

    }
);


/* =========================================================
   RESPONSIVE STATE
   ========================================================= */

window.addEventListener(
    "resize",
    () => {

        /*
            Moving into mobile:
            remove desktop collapse.
        */

        if (isMobile()) {

            sidebar.classList.remove(
                "collapsed"
            );

            return;

        }


        /*
            Moving back to desktop:
            close mobile drawer.
        */

        sidebar.classList.remove(
            "mobile-open"
        );


        /*
            Restore desktop preference.
        */

        const savedState =
            localStorage.getItem(
                "movipilotSidebarCollapsed"
            );


        if (
            savedState === "true"
        ) {

            sidebar.classList.add(
                "collapsed"
            );

        }

    }
);


/* =========================================================
   CINEMATIC PARTICLES
   ========================================================= */

const canvas =
    document.getElementById(
        "particleCanvas"
    );


const context =
    canvas.getContext(
        "2d"
    );


let particles = [];


/* =========================================================
   RESIZE CANVAS
   ========================================================= */

function resizeCanvas() {

    const devicePixelRatio =
        Math.min(
            window.devicePixelRatio || 1,
            2
        );


    canvas.width =
        window.innerWidth *
        devicePixelRatio;


    canvas.height =
        window.innerHeight *
        devicePixelRatio;


    canvas.style.width =
        window.innerWidth + "px";


    canvas.style.height =
        window.innerHeight + "px";


    context.setTransform(
        devicePixelRatio,
        0,
        0,
        devicePixelRatio,
        0,
        0
    );


    createParticles();

}


/* =========================================================
   CREATE PARTICLES
   ========================================================= */

function createParticles() {

    particles = [];


    let particleCount =
        260;


    /*
        Reduce the number of
        particles on small screens.
    */

    if (
        window.innerWidth < 720
    ) {

        particleCount =
            42;

    }


    for (
        let i = 0;
        i < particleCount;
        i++
    ) {

        particles.push({

            x:
                Math.random() *
                window.innerWidth,

            y:
                Math.random() *
                window.innerHeight,

            radius:
                Math.random() *
                1.5 +
                0.45,

            velocityX:
                (Math.random() - 0.5) *
                0.18,

            velocityY:
                (Math.random() - 0.5) *
                0.68,

            opacity:
                Math.random() *
                0.45 +
                0.30

        });

    }

}


/* =========================================================
   DRAW PARTICLES
   ========================================================= */

function drawParticles() {

    context.clearRect(
        0,
        0,
        window.innerWidth,
        window.innerHeight
    );


    for (
        let i = 0;
        i < particles.length;
        i++
    ) {

        const particle =
            particles[i];


        /*
            Movement
        */

        particle.x +=
            particle.velocityX;

        particle.y +=
            particle.velocityY;


        /*
            Horizontal wrap
        */

        if (
            particle.x < -10
        ) {

            particle.x =
                window.innerWidth + 10;

        }


        if (
            particle.x >
            window.innerWidth + 10
        ) {

            particle.x = -10;

        }


        /*
            Vertical wrap
        */

        if (
            particle.y < -10
        ) {

            particle.y =
                window.innerHeight + 10;

        }


        if (
            particle.y >
            window.innerHeight + 10
        ) {

            particle.y = -10;

        }


        /*
            Draw particle
        */

        context.beginPath();


        context.arc(
            particle.x,
            particle.y,
            particle.radius,
            0,
            Math.PI * 2
        );


        context.fillStyle =
            `rgba(
                102,
                211,
                207,
                ${particle.opacity}
            )`;


        context.fill();


        /*
            Connect nearby particles
        */

        for (
            let j = i + 1;
            j < particles.length;
            j++
        ) {

            const other =
                particles[j];


            const differenceX =
                particle.x -
                other.x;


            const differenceY =
                particle.y -
                other.y;


            const distance =
                Math.sqrt(
                    differenceX *
                    differenceX +

                    differenceY *
                    differenceY
                );


            if (
                distance < 105
            ) {

                const opacity =
                    (
                        1 -
                        distance / 105
                    ) * 0.09;


                context.beginPath();


                context.moveTo(
                    particle.x,
                    particle.y
                );


                context.lineTo(
                    other.x,
                    other.y
                );


                context.strokeStyle =
                    `rgba(
                        85,
                        170,
                        255,
                        ${opacity}
                    )`;


                context.lineWidth =
                    0.7;


                context.stroke();

            }

        }

    }


    requestAnimationFrame(
        drawParticles
    );

}


/* =========================================================
   START PARTICLE SYSTEM
   ========================================================= */

resizeCanvas();

drawParticles();


/* =========================================================
   RESIZE
   ========================================================= */

window.addEventListener(
    "resize",
    resizeCanvas
);


/* =========================================================
   MOVIPILOT HERO CAROUSEL
   + YOUTUBE TRAILER PLAYER
   ========================================================= */


/* =========================================================
   HERO ELEMENTS
   ========================================================= */

const trendingHero =
    document.getElementById("trendingHero");


const trendingHeroCarousel =
    document.getElementById("trendingHeroCarousel");


const trendingHeroTrack =
    document.getElementById("trendingHeroTrack");


const heroSlides =
    trendingHeroTrack
        ? Array.from(
            trendingHeroTrack.querySelectorAll(
                ".hero-slide"
            )
        )
        : [];


const heroPrevious =
    document.getElementById("heroPrevious");


const heroNext =
    document.getElementById("heroNext");


const heroDots =
    document.querySelectorAll(".hero-dot");


const heroCurrentNumber =
    document.getElementById(
        "heroCurrentNumber"
    );


let heroCurrentIndex = 0;


let heroAutoPlayTimer = null;


let heroTouchStartX = 0;


/* =========================================================
   HERO SETTINGS
   ========================================================= */

const HERO_AUTO_PLAY_DELAY = 7000;


const HERO_SWIPE_DISTANCE = 45;


const heroReducedMotion =
    window.matchMedia(
        "(prefers-reduced-motion: reduce)"
    );


/* =========================================================
   ACTIVE TRAILER
   ========================================================= */

let activeHeroTrailerSlide = null;


/* =========================================================
   EXTRACT YOUTUBE VIDEO ID
   ---------------------------------------------------------
   TMDB currently gives us the normal YouTube watch URL.

   Example:

   https://www.youtube.com/watch?v=abcdef12345

   We convert that into:

   https://www.youtube.com/embed/abcdef12345
   ========================================================= */

function getYouTubeVideoID(url) {

    if (!url) {

        return null;

    }


    try {

        const parsedURL =
            new URL(url);


        /* Standard watch URL */

        if (
            parsedURL.hostname.includes(
                "youtube.com"
            ) &&
            parsedURL.searchParams.get(
                "v"
            )
        ) {

            return parsedURL.searchParams.get(
                "v"
            );

        }


        /* youtu.be/VIDEO_ID */

        if (
            parsedURL.hostname ===
            "youtu.be"
        ) {

            return parsedURL.pathname
                .replace(
                    "/",
                    ""
                );

        }


        /* Existing embed URL */

        if (
            parsedURL.pathname.startsWith(
                "/embed/"
            )
        ) {

            return parsedURL.pathname
                .split(
                    "/embed/"
                )[1]
                .split(
                    "/"
                )[0];

        }


    } catch (error) {

        console.warn(
            "Invalid YouTube trailer URL:",
            url
        );

    }


    return null;

}


/* =========================================================
   CLOSE ACTIVE TRAILER
   ========================================================= */

function closeHeroTrailer(
    restartAutoPlay = true
) {

    if (
        !activeHeroTrailerSlide
    ) {

        return;

    }


    const slide =
        activeHeroTrailerSlide;


    const player =
        slide.querySelector(
            ".hero-trailer-player"
        );


    /*
        Remove the iframe completely.

        This is important because it also
        stops the video's audio.
    */

    if (player) {

        player.innerHTML = "";

    }


    slide.classList.remove(
        "is-trailer-playing"
    );


    activeHeroTrailerSlide =
        null;


    /*
        Start carousel again when the
        user returns to movie mode.
    */

    if (restartAutoPlay) {

        startHeroAutoPlay();

    }

}


/* =========================================================
   OPEN YOUTUBE TRAILER
   ========================================================= */

function openHeroTrailer(
    slide
) {

    if (!slide) {

        return;

    }


    const trailerButton =
        slide.querySelector(
            ".hero-trailer-button:not(.is-disabled)"
        );


    if (!trailerButton) {

        return;

    }


    const trailerURL =
        trailerButton.dataset.trailerUrl;


    const videoID =
        getYouTubeVideoID(
            trailerURL
        );


    if (!videoID) {

        console.warn(
            "Could not extract YouTube video ID:",
            trailerURL
        );

        return;

    }


    /*
        Close any trailer that might
        already be active.
    */

    closeHeroTrailer(
        false
    );


    const player =
        slide.querySelector(
            ".hero-trailer-player"
        );


    if (!player) {

        return;

    }


    
    const origin =
        encodeURIComponent(
            window.location.origin
        );


    const embedURL =
        "https://www.youtube.com/embed/" +
        encodeURIComponent(videoID) +
        "?autoplay=1" +
        "&playsinline=1" +
        "&rel=0" +
        "&enablejsapi=1" +
        "&origin=" +
        origin;


    const iframe =
        document.createElement(
            "iframe"
        );


    iframe.src =
        embedURL;


    iframe.title =
        "MoviPilot trailer player";


    iframe.allow =
        "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";


    iframe.allowFullscreen =
        true;


    iframe.referrerPolicy =
        "strict-origin-when-cross-origin";


    iframe.loading =
        "eager";


    player.appendChild(
        iframe
    );


    slide.classList.add(
        "is-trailer-playing"
    );


    activeHeroTrailerSlide =
        slide;


    /*
        Stop the carousel while
        the trailer is playing.
    */

    stopHeroAutoPlay();

}


/* =========================================================
   MOVE TO HERO SLIDE
   ========================================================= */

function goToHeroSlide(
    index
) {

    if (
        !heroSlides.length ||
        !trendingHeroTrack
    ) {

        return;

    }


    /*
        If another trailer is playing,
        close it before changing slides.
    */

    closeHeroTrailer(
        false
    );


    /*
        Wrap around.
    */

    if (index < 0) {

        index =
            heroSlides.length - 1;

    }


    if (
        index >=
        heroSlides.length
    ) {

        index = 0;

    }


    heroCurrentIndex =
        index;


    trendingHeroTrack.style.transform =
        `translate3d(-${index * 100}%, 0, 0)`;


    heroSlides.forEach(
        (
            slide,
            slideIndex
        ) => {

            slide.classList.toggle(
                "is-active",
                slideIndex === index
            );

        }
    );


    heroDots.forEach(
        (
            dot,
            dotIndex
        ) => {

            const isActive =
                dotIndex === index;


            dot.classList.toggle(
                "is-active",
                isActive
            );


            dot.setAttribute(
                "aria-current",
                isActive
                    ? "true"
                    : "false"
            );

        }
    );


    if (
        heroCurrentNumber
    ) {

        heroCurrentNumber.textContent =
            String(
                index + 1
            ).padStart(
                2,
                "0"
            );

    }

}


/* =========================================================
   AUTOPLAY
   ========================================================= */

function stopHeroAutoPlay() {

    if (
        heroAutoPlayTimer
    ) {

        clearInterval(
            heroAutoPlayTimer
        );


        heroAutoPlayTimer =
            null;

    }

}


function startHeroAutoPlay() {

    stopHeroAutoPlay();


    if (
        heroReducedMotion.matches ||
        heroSlides.length <= 1 ||
        activeHeroTrailerSlide
    ) {

        return;

    }


    heroAutoPlayTimer =
        setInterval(
            () => {

                goToHeroSlide(
                    heroCurrentIndex + 1
                );

            },
            HERO_AUTO_PLAY_DELAY
        );

}


/* =========================================================
   MANUAL SLIDE MOVEMENT
   ========================================================= */

function moveHeroSlide(
    index
) {

    goToHeroSlide(
        index
    );


    startHeroAutoPlay();

}


/* =========================================================
   TRAILER BUTTONS
   ========================================================= */

const heroTrailerButtons =
    document.querySelectorAll(
        ".hero-trailer-button:not(.is-disabled)"
    );


heroTrailerButtons.forEach(
    (button) => {

        button.addEventListener(
            "click",
            () => {

                const slide =
                    button.closest(
                        ".hero-slide"
                    );


                openHeroTrailer(
                    slide
                );

            }
        );

    }
);


/* =========================================================
   TRAILER CLOSE BUTTONS
   ========================================================= */

const heroTrailerCloseButtons =
    document.querySelectorAll(
        ".hero-trailer-close"
    );


heroTrailerCloseButtons.forEach(
    (button) => {

        button.addEventListener(
            "click",
            () => {

                closeHeroTrailer(
                    true
                );

            }
        );

    }
);


/* =========================================================
   ARROW CONTROLS
   ========================================================= */

if (heroPrevious) {

    heroPrevious.addEventListener(
        "click",
        () => {

            moveHeroSlide(
                heroCurrentIndex - 1
            );

        }
    );

}


if (heroNext) {

    heroNext.addEventListener(
        "click",
        () => {

            moveHeroSlide(
                heroCurrentIndex + 1
            );

        }
    );

}


/* =========================================================
   DOT CONTROLS
   ========================================================= */

heroDots.forEach(
    (dot) => {

        dot.addEventListener(
            "click",
            () => {

                const slideIndex =
                    Number(
                        dot.dataset.slideTo
                    );


                moveHeroSlide(
                    slideIndex
                );

            }
        );

    }
);


/* =========================================================
   PAUSE AUTOPLAY WHEN HOVERING HERO
   ========================================================= */

if (trendingHero) {

    trendingHero.addEventListener(
        "mouseenter",
        () => {

            stopHeroAutoPlay();

        }
    );


    trendingHero.addEventListener(
        "mouseleave",
        () => {

            if (
                !activeHeroTrailerSlide
            ) {

                startHeroAutoPlay();

            }

        }
    );


    trendingHero.addEventListener(
        "focusin",
        () => {

            stopHeroAutoPlay();

        }
    );


    trendingHero.addEventListener(
        "focusout",
        (event) => {

            if (
                !trendingHero.contains(
                    event.relatedTarget
                )
            ) {

                if (
                    !activeHeroTrailerSlide
                ) {

                    startHeroAutoPlay();

                }

            }

        }
    );

}


/* =========================================================
   KEYBOARD NAVIGATION
   ========================================================= */

if (
    trendingHeroCarousel
) {

    trendingHeroCarousel.addEventListener(
        "keydown",
        (event) => {

            if (
                event.key ===
                "ArrowLeft"
            ) {

                event.preventDefault();


                moveHeroSlide(
                    heroCurrentIndex - 1
                );

            }


            if (
                event.key ===
                "ArrowRight"
            ) {

                event.preventDefault();


                moveHeroSlide(
                    heroCurrentIndex + 1
                );

            }


            /*
                Escape closes an active trailer.
            */

            if (
                event.key ===
                "Escape"
            ) {

                if (
                    activeHeroTrailerSlide
                ) {

                    event.preventDefault();


                    closeHeroTrailer(
                        true
                    );

                }

            }

        }
    );

}


/* =========================================================
   TOUCH SWIPE
   ========================================================= */

if (
    trendingHeroCarousel
) {

    trendingHeroCarousel.addEventListener(
        "touchstart",
        (event) => {

            heroTouchStartX =
                event.changedTouches[0]
                    .clientX;

        },
        {
            passive: true
        }
    );


    trendingHeroCarousel.addEventListener(
        "touchend",
        (event) => {

            /*
                Don't treat a touch on the
                YouTube player as carousel
                navigation.
            */

            if (
                activeHeroTrailerSlide
            ) {

                return;

            }


            const heroTouchEndX =
                event.changedTouches[0]
                    .clientX;


            const distance =
                heroTouchEndX -
                heroTouchStartX;


            if (
                Math.abs(distance) <
                HERO_SWIPE_DISTANCE
            ) {

                return;

            }


            if (
                distance < 0
            ) {

                moveHeroSlide(
                    heroCurrentIndex + 1
                );

            } else {

                moveHeroSlide(
                    heroCurrentIndex - 1
                );

            }

        },
        {
            passive: true
        }
    );

}


/* =========================================================
   WATCHLIST VISUAL STATE
   ========================================================= */

const heroWatchlistButtons =
    document.querySelectorAll(
        ".hero-watchlist-button"
    );


heroWatchlistButtons.forEach(
    (button) => {

        button.addEventListener(
            "click",
            () => {

                const isAdded =
                    button.classList.toggle(
                        "is-added"
                    );


                button.setAttribute(
                    "aria-pressed",
                    String(
                        isAdded
                    )
                );


                const label =
                    button.querySelector(
                        ".hero-watchlist-label"
                    );


                if (label) {

                    label.textContent =
                        isAdded
                            ? "Added to Watchlist"
                            : "Add to Watchlist";

                }


                console.log(
                    isAdded
                        ? "Added movie to watchlist:"
                        : "Removed movie from watchlist:",
                    button.dataset.movieId
                );

            }
        );

    }
);


/* =========================================================
   KNOW MORE BUTTON
   ========================================================= */

const heroDetailsButtons =
    document.querySelectorAll(
        ".hero-details-button"
    );


heroDetailsButtons.forEach(
    (button) => {

        button.addEventListener(
            "click",
            () => {

                console.log(
                    "Know more about movie:",
                    button.dataset.movieId
                );

                /*
                    Later:

                    window.location.href =
                        "/movie?id=" +
                        encodeURIComponent(
                            button.dataset.movieId
                        );
                */

            }
        );

    }
);


/* =========================================================
   INITIALIZE HERO
   ========================================================= */

goToHeroSlide(
    0
);


startHeroAutoPlay();


/* =========================================================
   REDUCED MOTION
   ========================================================= */

heroReducedMotion.addEventListener(
    "change",
    () => {

        if (
            heroReducedMotion.matches
        ) {

            stopHeroAutoPlay();

        } else {

            startHeroAutoPlay();

        }

    }
);

/* =========================================================
   MOVIPILOT MOVIE ROW CAROUSELS
   ---------------------------------------------------------
   Handles:

   - Movies You May Like
   - Top Rated Movies
   - Popular Movie Trailers
   - Automatic movement
   - Arrow controls
   - Image loading
   - Inline YouTube trailers
   ========================================================= */


/* =========================================================
   GLOBAL TRAILER STATE
   ========================================================= */

let activeMovieTrailerMedia =
    null;

let activeMovieTrailerCard =
    null;

let activeMovieTrailerSection =
    null;


/* =========================================================
   REDUCED MOTION
   ========================================================= */

const movieRowsReducedMotion =
    window.matchMedia(
        "(prefers-reduced-motion: reduce)"
    );


/* =========================================================
   CAROUSEL SECTIONS
   ========================================================= */

const movieRowSections =
    document.querySelectorAll(
        "[data-section-carousel]"
    );


movieRowSections.forEach(
    (section) => {

        const carouselName =
            section.dataset.sectionCarousel;


        const viewport =
            section.querySelector(
                `[data-carousel-window="${carouselName}"]`
            );


        const track =
            section.querySelector(
                `[data-carousel-track="${carouselName}"]`
            );


        if (
            !viewport ||
            !track
        ) {

            return;

        }


        let autoTimer =
            null;


        let pointerInside =
            false;


        const AUTO_DELAY =
            5500;


        const isTrailerSection =
            carouselName ===
            "popular-trailers";


        /* =====================================================
           IS VIDEO LOCKED?
           ===================================================== */

        function isVideoLocked() {

            return (
                isTrailerSection &&
                section.classList.contains(
                    "is-video-active"
                )
            );

        }


        /* =====================================================
           STOP AUTOPLAY
           ===================================================== */

        function stopAutoPlay() {

            if (
                autoTimer
            ) {

                clearInterval(
                    autoTimer
                );

                autoTimer =
                    null;

            }

        }


        /* =====================================================
           START AUTOPLAY
           ===================================================== */

        function startAutoPlay() {

            stopAutoPlay();


            if (
                movieRowsReducedMotion.matches
            ) {

                return;

            }


            /*
                NEVER restart the trailer
                carousel while a video is open.
            */

            if (
                isVideoLocked()
            ) {

                return;

            }


            if (
                pointerInside
            ) {

                return;

            }


            autoTimer =
                setInterval(
                    () => {

                        if (
                            isVideoLocked()
                        ) {

                            stopAutoPlay();

                            return;

                        }


                        moveMovieRow(
                            1
                        );

                    },
                    AUTO_DELAY
                );

        }


        /* =====================================================
           CALCULATE MOVEMENT
           ===================================================== */

        function getMoveDistance() {

            /*
                Move most of the visible viewport
                rather than just one card.

                This makes the carousel feel
                like a curated shelf.
            */

            return Math.max(
                viewport.clientWidth * 0.84,
                180
            );

        }


        /* =====================================================
           MOVE MOVIE ROW
           ===================================================== */

        function moveMovieRow(
            direction
        ) {

            /*
                Most important protection.

                When a trailer is active, the
                row is completely locked.
            */

            if (
                isVideoLocked()
            ) {

                return;

            }


            const maxScroll =
                viewport.scrollWidth -
                viewport.clientWidth;


            const currentScroll =
                viewport.scrollLeft;


            const distance =
                getMoveDistance();


            if (
                direction > 0
            ) {

                /*
                    Reached the end.
                    Return smoothly to the beginning.
                */

                if (
                    currentScroll >=
                    maxScroll - 8
                ) {

                    viewport.scrollTo({
                        left: 0,
                        behavior: "smooth"
                    });

                    return;

                }


                viewport.scrollBy({

                    left:
                        distance,

                    behavior:
                        "smooth"

                });


                return;

            }


            /*
                Moving backward.
            */

            if (
                currentScroll <= 8
            ) {

                viewport.scrollTo({

                    left:
                        maxScroll,

                    behavior:
                        "smooth"

                });

                return;

            }


            viewport.scrollBy({

                left:
                    -distance,

                behavior:
                    "smooth"

            });

        }


        /* =====================================================
           ARROW BUTTONS
           ===================================================== */

        const carouselArrows =
            section.querySelectorAll(
                ".mp-carousel-arrow"
            );


        carouselArrows.forEach(
            (arrow) => {

                arrow.addEventListener(
                    "click",
                    (event) => {

                        event.preventDefault();


                        /*
                            Don't allow arrow movement
                            while a trailer is playing.
                        */

                        if (
                            isVideoLocked()
                        ) {

                            return;

                        }


                        const direction =
                            arrow.dataset.carouselDirection ===
                            "next"
                                ? 1
                                : -1;


                        moveMovieRow(
                            direction
                        );


                        /*
                            The arrow interaction means
                            the user is controlling the shelf.
                        */

                        stopAutoPlay();


                        setTimeout(
                            startAutoPlay,
                            650
                        );

                    }
                );

            }
        );


        /* =====================================================
           HOVER PAUSE
           ===================================================== */

        section.addEventListener(
            "mouseenter",
            () => {

                pointerInside =
                    true;


                stopAutoPlay();

            }
        );


        section.addEventListener(
            "mouseleave",
            () => {

                pointerInside =
                    false;


                startAutoPlay();

            }
        );

        section.addEventListener(
    "movipilotTrailerOpened",
    () => {

        stopAutoPlay();

    }
);


section.addEventListener(
    "movipilotTrailerClosed",
    () => {

        pointerInside =
            false;

        startAutoPlay();

    }
);


        /* =====================================================
           FOCUS PAUSE
           ===================================================== */

        section.addEventListener(
            "focusin",
            () => {

                pointerInside =
                    true;


                stopAutoPlay();

            }
        );


        section.addEventListener(
            "focusout",
            (event) => {

                if (
                    !section.contains(
                        event.relatedTarget
                    )
                ) {

                    pointerInside =
                        false;


                    startAutoPlay();

                }

            }
        );


        /* =====================================================
           START THIS ROW
           ===================================================== */

        startAutoPlay();

    }
);



/* =========================================================
   MOVIE POSTER / BACKDROP LOADERS
   ========================================================= */

const movieRowImages =
    document.querySelectorAll(
        ".mp-card-image, .mp-trailer-image"
    );


movieRowImages.forEach(
    (image) => {

        const media =
            image.closest(
                ".mp-card-media, .mp-trailer-media"
            );


        if (
            !media
        ) {

            return;

        }


        function markLoaded() {

            media.classList.add(
                "is-loaded"
            );


            media.classList.remove(
                "is-error"
            );

        }


        function markError() {

            media.classList.remove(
                "is-loaded"
            );


            media.classList.add(
                "is-error"
            );

        }


        /*
            Cached image.
        */

        if (
            image.complete
        ) {

            if (
                image.naturalWidth > 0
            ) {

                markLoaded();

            } else {

                markError();

            }

        }


        image.addEventListener(
            "load",
            markLoaded
        );


        image.addEventListener(
            "error",
            markError
        );

    }
);





/* =========================================================
   YOUTUBE VIDEO ID
   ========================================================= */

function getMovieRowYouTubeID(
    url
) {

    if (
        !url
    ) {

        return null;

    }


    try {

        const parsedURL =
            new URL(url);


        /*
            youtube.com/watch?v=VIDEO_ID
        */

        const watchID =
            parsedURL.searchParams.get(
                "v"
            );


        if (
            watchID
        ) {

            return watchID;

        }


        /*
            youtu.be/VIDEO_ID
        */

        if (
            parsedURL.hostname ===
            "youtu.be"
        ) {

            return parsedURL.pathname
                .replace(
                    "/",
                    ""
                );

        }


        /*
            youtube.com/embed/VIDEO_ID
        */

        if (
            parsedURL.pathname.startsWith(
                "/embed/"
            )
        ) {

            return parsedURL.pathname
                .split(
                    "/embed/"
                )[1]
                .split(
                    "/"
                )[0];

        }

    } catch (error) {

        console.warn(
            "Invalid YouTube trailer URL:",
            url
        );

    }


    return null;

}



/* =========================================================
   CLOSE MOVIE TRAILER
   ========================================================= */

function closeMovieTrailer(
    restoreAutoPlay
) {

    if (
        !activeMovieTrailerMedia
    ) {

        return;

    }


    const media =
        activeMovieTrailerMedia;


    const card =
        activeMovieTrailerCard;


    const section =
        activeMovieTrailerSection;


    const player =
        media.querySelector(
            ".mp-trailer-player"
        );


    /*
        Completely remove iframe.

        This stops the YouTube player and
        its audio immediately.
    */

    if (
        player
    ) {

        player.innerHTML =
            "";

    }


    media.classList.remove(
        "is-playing"
    );


    if (
        card
    ) {

        card.classList.remove(
            "is-video-active"
        );

    }


    if (
    restoreAutoPlay &&
    section
) {

        section.classList.remove(
            "is-video-active"
        );

    }


    activeMovieTrailerMedia =
        null;


    activeMovieTrailerCard =
        null;


    activeMovieTrailerSection =
        null;


    /*
        Resume automatic movement only
        after the trailer has been closed.
    */

    if (
        restoreAutoPlay
    ) {

        if (
    section
) {

    section.dispatchEvent(
        new Event(
            "movipilotTrailerClosed"
        )
    );

}
    }

}



/* =========================================================
   OPEN MOVIE TRAILER
   ========================================================= */

function openMovieTrailer(
    button
) {

    const media =
        button.closest(
            ".mp-trailer-media"
        );


    const card =
        button.closest(
            ".mp-trailer-card"
        );


    const section =
        button.closest(
            ".mp-trailer-section"
        );


    if (
        !media ||
        !card ||
        !section
    ) {

        return;

    }


    const trailerURL =
        button.dataset.trailerUrl;


    const videoID =
        getMovieRowYouTubeID(
            trailerURL
        );


    if (
        !videoID
    ) {

        console.warn(
            "Could not find YouTube trailer ID.",
            trailerURL
        );

        return;

    }


    /*
        Close another active trailer first.
    */

    closeMovieTrailer(
        false
    );


    const player =
        media.querySelector(
            ".mp-trailer-player"
        );


    if (
        !player
    ) {

        return;

    }


    /*
        Put the section into VIDEO LOCK mode.

        This stops:
        - autoplay
        - arrow movement
        - automatic scrolling
    */

    section.classList.add(
        "is-video-active"
    );


    card.classList.add(
        "is-video-active"
    );


    const origin =
        encodeURIComponent(
            window.location.origin
        );


    const embedURL =
        "https://www.youtube.com/embed/" +
        encodeURIComponent(
            videoID
        ) +
        "?autoplay=1" +
        "&playsinline=1" +
        "&rel=0" +
        "&enablejsapi=1" +
        "&origin=" +
        origin;


    const iframe =
        document.createElement(
            "iframe"
        );


    iframe.src =
        embedURL;


    iframe.title =
        "MoviPilot movie trailer";


    iframe.allow =
        "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";


    iframe.allowFullscreen =
        true;


    iframe.referrerPolicy =
        "strict-origin-when-cross-origin";


    iframe.loading =
        "eager";


    player.appendChild(
        iframe
    );


    media.classList.add(
        "is-playing"
    );


    activeMovieTrailerMedia =
        media;


    activeMovieTrailerCard =
        card;


    activeMovieTrailerSection =
        section;


    /*
        Stop all timers belonging to
        the trailer section.
    */

    section.dispatchEvent(
        new Event(
            "movipilotTrailerOpened"
        )
    );

}



/* =========================================================
   WATCH NOW BUTTONS
   ========================================================= */

const movieWatchNowButtons =
    document.querySelectorAll(
        ".mp-watch-now-button:not(.is-disabled)"
    );


movieWatchNowButtons.forEach(
    (button) => {

        button.addEventListener(
            "click",
            (event) => {

                event.preventDefault();

                event.stopPropagation();


                openMovieTrailer(
                    button
                );

            }
        );

    }
);



/* =========================================================
   CLOSE TRAILER BUTTONS
   ========================================================= */

const movieTrailerCloseButtons =
    document.querySelectorAll(
        ".mp-trailer-close"
    );


movieTrailerCloseButtons.forEach(
    (button) => {

        button.addEventListener(
            "click",
            (event) => {

                event.preventDefault();

                event.stopPropagation();


                closeMovieTrailer(
                    true
                );

            }
        );

    }
);




/* =========================================================
   ESCAPE KEY
   ========================================================= */

document.addEventListener(
    "keydown",
    (event) => {

        if (
            event.key ===
            "Escape"
        ) {

            closeMovieTrailer(
                true
            );

        }

    }
);