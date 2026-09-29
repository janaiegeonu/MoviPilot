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