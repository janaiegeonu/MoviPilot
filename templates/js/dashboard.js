/* =========================================================
   MOVIPILOT DASHBOARD JS
   ========================================================= */

console.log(
    "MOVIPILOT DASHBOARD JS LOADED"
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


const genreButton =
    document.getElementById(
        "genreButton"
    );


const genreDropdown =
    document.getElementById(
        "genreDropdown"
    );


/* =========================================================
   MOBILE CHECK
   ========================================================= */

function isMobile() {

    return window.innerWidth <= 720;

}


/* =========================================================
   DESKTOP SIDEBAR STATE
   ========================================================= */

function setSidebarCollapsed(
    collapsed
) {

    /*
        Mobile does not use this function.
    */

    if (isMobile()) {

        return;

    }


    sidebar.classList.toggle(
        "collapsed",
        collapsed
    );


    localStorage.setItem(
        "movipilotSidebarCollapsed",
        collapsed
    );

}


/* =========================================================
   RESTORE SIDEBAR STATE
   ========================================================= */

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

}


/* =========================================================
   SIDEBAR TOGGLE
   ========================================================= */

sidebarToggle.addEventListener(
    "click",
    (event) => {

        event.stopPropagation();


        /*
            On mobile, this button closes
            the sidebar instead of changing
            it into icon mode.

            The hamburger opens it again.
        */

        if (isMobile()) {

            sidebar.classList.remove(
                "mobile-open"
            );

            return;

        }


        const shouldCollapse =
            !sidebar.classList.contains(
                "collapsed"
            );


        setSidebarCollapsed(
            shouldCollapse
        );


        /*
            Close the Genre dropdown
            when entering icon-only mode.
        */

        if (shouldCollapse) {

            genreDropdown.classList.remove(
                "open"
            );

            genreButton.classList.remove(
                "open"
            );

            genreButton.setAttribute(
                "aria-expanded",
                "false"
            );

        }

    }
);


/* =========================================================
   MOBILE HAMBURGER
   ========================================================= */

mobileMenuButton.addEventListener(
    "click",
    (event) => {

        event.stopPropagation();


        sidebar.classList.toggle(
            "mobile-open"
        );

    }
);


/* =========================================================
   CLOSE MOBILE SIDEBAR
   WHEN CLICKING OUTSIDE
   ========================================================= */

document.addEventListener(
    "click",
    (event) => {

        if (!isMobile()) {

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

            sidebar.classList.remove(
                "mobile-open"
            );

        }

    }
);


/* =========================================================
   GENRE DROPDOWN
   ========================================================= */

genreButton.addEventListener(
    "click",
    (event) => {

        event.stopPropagation();


        /*
            Don't open Genre dropdown
            while desktop sidebar is
            icon-only.
        */

        if (
            !isMobile() &&
            sidebar.classList.contains(
                "collapsed"
            )
        ) {

            return;

        }


        const isOpen =
            genreDropdown.classList.contains(
                "open"
            );


        genreDropdown.classList.toggle(
            "open"
        );


        genreButton.classList.toggle(
            "open"
        );


        genreButton.setAttribute(
            "aria-expanded",
            String(!isOpen)
        );

    }
);


/* =========================================================
   GENRE HOVER ANIMATION
   ========================================================= */

genreButton.addEventListener(
    "mouseenter",
    () => {

        /*
            Remove first so the animation
            can restart every time the user
            leaves and comes back.
        */

        genreButton.classList.remove(
            "is-animating"
        );


        requestAnimationFrame(
            () => {

                genreButton.classList.add(
                    "is-animating"
                );

            }
        );

    }
);


genreButton.addEventListener(
    "mouseleave",
    () => {

        genreButton.classList.remove(
            "is-animating"
        );

    }
);


/* =========================================================
   NAVIGATION
   ========================================================= */

const navigationButtons =
    document.querySelectorAll(
        ".nav-link"
    );


navigationButtons.forEach(
    (button) => {

        button.addEventListener(
            "click",
            () => {

                navigationButtons.forEach(
                    (item) => {

                        item.classList.remove(
                            "active"
                        );

                    }
                );


                button.classList.add(
                    "active"
                );


                console.log(
                    "Selected page:",
                    button.dataset.page
                );

            }
        );

    }
);


/* =========================================================
   GENRE OPTIONS
   ========================================================= */

const genreOptions =
    document.querySelectorAll(
        ".genre-option"
    );


genreOptions.forEach(
    (option) => {

        option.addEventListener(
            "click",
            () => {

                const selectedGenre =
                    option.textContent.trim();


                console.log(
                    "Selected genre:",
                    selectedGenre
                );


                /*
                    Later:

                    window.location.href =
                        "/genre?q=" +
                        encodeURIComponent(
                            selectedGenre
                        );
                */

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
   - Automatic sliding
   - Arrow controls
   - Pause on hover
   - Touch / trackpad scrolling
   ========================================================= */


/* =========================================================
   CAROUSEL INITIALIZER
   ========================================================= */

const movieRowCarousels =
    document.querySelectorAll(
        "[data-section-carousel]"
    );


movieRowCarousels.forEach(
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


        let userIsInteracting =
            false;


        const AUTO_DELAY =
            5500;


        /* =====================================================
           CALCULATE SLIDE DISTANCE
           ===================================================== */

        function getSlideDistance() {

            /*
                Move approximately one visible
                viewport at a time.

                This gives the feeling of a
                page-based movie carousel.
            */

            return viewport.clientWidth * 0.88;

        }


        /* =====================================================
           MOVE CAROUSEL
           ===================================================== */

        function moveCarousel(
            direction
        ) {

            const maxScroll =
                viewport.scrollWidth -
                viewport.clientWidth;


            const currentScroll =
                viewport.scrollLeft;


            const distance =
                getSlideDistance();


            /*
                Moving forward.
            */

            if (
                direction > 0
            ) {

                if (
                    currentScroll >=
                    maxScroll - 8
                ) {

                    /*
                        We've reached the end.

                        Reset to the beginning.
                    */

                    viewport.scrollTo({
                        left: 0,
                        behavior: "auto"
                    });

                    return;

                }


                viewport.scrollBy({
                    left: distance,
                    behavior: "smooth"
                });


                return;

            }


            /*
                Moving backward.
            */

            if (
                currentScroll <= 8
            ) {

                /*
                    Reset to the end.
                */

                viewport.scrollTo({
                    left: maxScroll,
                    behavior: "auto"
                });

                return;

            }


            viewport.scrollBy({
                left: -distance,
                behavior: "smooth"
            });

        }


        /* =====================================================
           ARROW BUTTONS
           ===================================================== */

        const arrows =
            section.querySelectorAll(
                ".mp-carousel-arrow"
            );


        arrows.forEach(
            (arrow) => {

                arrow.addEventListener(
                    "click",
                    () => {

                        const direction =
                            arrow.dataset.carouselDirection ===
                            "next"
                                ? 1
                                : -1;


                        moveCarousel(
                            direction
                        );


                        /*
                            Restart autoplay from
                            the current position.
                        */

                        startAutoPlay();

                    }
                );

            }
        );


        /* =====================================================
           AUTOPLAY
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


        function startAutoPlay() {

            stopAutoPlay();


            if (
                window.matchMedia(
                    "(prefers-reduced-motion: reduce)"
                ).matches
            ) {

                return;

            }


            if (
                userIsInteracting
            ) {

                return;

            }


            autoTimer =
                setInterval(
                    () => {

                        moveCarousel(
                            1
                        );

                    },
                    AUTO_DELAY
                );

        }


        /* =====================================================
           PAUSE WHILE HOVERING
           ===================================================== */

        section.addEventListener(
            "mouseenter",
            () => {

                userIsInteracting =
                    true;


                stopAutoPlay();

            }
        );


        section.addEventListener(
            "mouseleave",
            () => {

                userIsInteracting =
                    false;


                startAutoPlay();

            }
        );


        /* =====================================================
           FOCUS SUPPORT
           ===================================================== */

        section.addEventListener(
            "focusin",
            () => {

                userIsInteracting =
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

                    userIsInteracting =
                        false;


                    startAutoPlay();

                }

            }
        );


        /* =====================================================
           START CAROUSEL
           ===================================================== */

        startAutoPlay();

    }
);



/* =========================================================
   MOVIE POSTER LOADERS
   ---------------------------------------------------------
   The loader remains visible while TMDB artwork is loading.
   ========================================================= */

const dashboardMovieImages =
    document.querySelectorAll(
        ".mp-card-image, .mp-trailer-image"
    );


dashboardMovieImages.forEach(
    (image) => {

        const media =
            image.closest(
                ".mp-card-media, .mp-trailer-media"
            );


        if (!media) {

            return;

        }


        function markImageLoaded() {

            media.classList.add(
                "is-loaded"
            );

            media.classList.remove(
                "is-error"
            );

        }


        function markImageError() {

            media.classList.remove(
                "is-loaded"
            );

            media.classList.add(
                "is-error"
            );

        }


        /*
            Cached images may already be complete
            before the event listener executes.
        */

        if (
            image.complete
        ) {

            if (
                image.naturalWidth > 0
            ) {

                markImageLoaded();

            } else {

                markImageError();

            }

        }


        image.addEventListener(
            "load",
            markImageLoaded
        );


        image.addEventListener(
            "error",
            markImageError
        );

    }
);



/* =========================================================
   EXPLORE MOVIE BUTTONS
   ---------------------------------------------------------
   The route will be connected later.
   ========================================================= */

const exploreMovieButtons =
    document.querySelectorAll(
        ".mp-explore-button"
    );


exploreMovieButtons.forEach(
    (button) => {

        button.addEventListener(
            "click",
            (event) => {

                event.stopPropagation();


                const movieID =
                    button.dataset.movieId;


                console.log(
                    "Explore movie:",
                    movieID
                );


                /*
                    Later:

                    window.location.href =
                        "/movie?id=" +
                        encodeURIComponent(
                            movieID
                        );
                */

            }
        );

    }
);



/* =========================================================
   YOUTUBE TRAILER HELPERS
   ========================================================= */

function getMovieRowYouTubeID(
    url
) {

    if (!url) {

        return null;

    }


    try {

        const parsedURL =
            new URL(url);


        /*
            Standard:

            youtube.com/watch?v=VIDEO_ID
        */

        const standardID =
            parsedURL.searchParams.get(
                "v"
            );


        if (
            standardID
        ) {

            return standardID;

        }


        /*
            Short:

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
            Existing embed:

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
            "Invalid trailer URL:",
            url
        );

    }


    return null;

}



/* =========================================================
   ACTIVE INLINE TRAILER
   ========================================================= */

let activeMovieTrailerMedia =
    null;



/* =========================================================
   CLOSE INLINE TRAILER
   ========================================================= */

function closeMovieTrailer(
    restartCard
) {

    if (
        !activeMovieTrailerMedia
    ) {

        return;

    }


    const media =
        activeMovieTrailerMedia;


    const player =
        media.querySelector(
            ".mp-trailer-player"
        );


    if (
        player
    ) {

        /*
            Completely remove the iframe.

            This immediately stops
            video playback/audio.
        */

        player.innerHTML =
            "";

    }


    media.classList.remove(
        "is-playing"
    );


    activeMovieTrailerMedia =
        null;


    if (
        restartCard
    ) {

        const button =
            media.querySelector(
                ".mp-watch-now-button"
            );


        if (
            button
        ) {

            button.focus();

        }

    }

}



/* =========================================================
   OPEN INLINE TRAILER
   ========================================================= */

function openMovieTrailer(
    button
) {

    const media =
        button.closest(
            ".mp-trailer-media"
        );


    if (
        !media
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
            "Trailer video ID could not be found.",
            trailerURL
        );

        return;

    }


    /*
        Close any other trailer first.
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

}



/* =========================================================
   WATCH NOW BUTTONS
   ========================================================= */

const movieTrailerButtons =
    document.querySelectorAll(
        ".mp-watch-now-button:not(.is-disabled)"
    );


movieTrailerButtons.forEach(
    (button) => {

        button.addEventListener(
            "click",
            (event) => {

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

                event.stopPropagation();


                const media =
                    button.closest(
                        ".mp-trailer-media"
                    );


                if (
                    media ===
                    activeMovieTrailerMedia
                ) {

                    closeMovieTrailer(
                        true
                    );

                }

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
                false
            );

        }

    }
);