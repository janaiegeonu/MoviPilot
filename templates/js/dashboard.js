/* =========================================================
   MOVIPILOT DASHBOARD JS
   ========================================================= */

console.log("MOVIPILOT DASHBOARD JS LOADED");


/* =========================================================
   SIDEBAR
   ========================================================= */

const sidebar =
    document.getElementById("dashboardSidebar");

const sidebarToggle =
    document.getElementById("sidebarToggle");

const mobileMenuButton =
    document.getElementById("mobileMenuButton");


/*
    Desktop:
    Clicking the toggle changes the sidebar between:

    252px = expanded
     82px = collapsed
*/

sidebarToggle.addEventListener("click", () => {

    /*
        On mobile we don't actually collapse the sidebar.
        We use it as a normal slide-out menu.
    */

    if (window.innerWidth <= 720) {

        sidebar.classList.toggle("mobile-open");

        return;
    }


    sidebar.classList.toggle("collapsed");


    /*
        Save the user's preference.

        That means if they reload the dashboard,
        their sidebar state can be restored.
    */

    const collapsed =
        sidebar.classList.contains("collapsed");

    localStorage.setItem(
        "movipilotSidebarCollapsed",
        collapsed
    );
});


/* =========================================================
   RESTORE SIDEBAR STATE
   ========================================================= */

const savedSidebarState =
    localStorage.getItem(
        "movipilotSidebarCollapsed"
    );


if (
    savedSidebarState === "true" &&
    window.innerWidth > 720
) {

    sidebar.classList.add("collapsed");

}


/* =========================================================
   MOBILE MENU
   ========================================================= */

mobileMenuButton.addEventListener("click", () => {

    sidebar.classList.toggle("mobile-open");

});


/* =========================================================
   GENRE DROPDOWN
   ========================================================= */

const genreButton =
    document.getElementById("genreButton");

const genreDropdown =
    document.getElementById("genreDropdown");


genreButton.addEventListener("click", () => {

    const isOpen =
        genreDropdown.classList.contains("open");


    genreDropdown.classList.toggle(
        "open"
    );

    genreButton.classList.toggle(
        "open"
    );


    genreButton.setAttribute(
        "aria-expanded",
        !isOpen
    );

});


/* =========================================================
   CLOSE SIDEBAR ON MOBILE
   WHEN CLICKING OUTSIDE
   ========================================================= */

document.addEventListener("click", (event) => {

    const clickedInsideSidebar =
        sidebar.contains(event.target);

    const clickedMobileButton =
        mobileMenuButton.contains(event.target);


    if (
        window.innerWidth <= 720 &&
        !clickedInsideSidebar &&
        !clickedMobileButton
    ) {

        sidebar.classList.remove(
            "mobile-open"
        );

    }

});


/* =========================================================
   MAIN NAVIGATION
   ========================================================= */

const navigationButtons =
    document.querySelectorAll(".nav-link");


navigationButtons.forEach((button) => {

    button.addEventListener("click", () => {

        navigationButtons.forEach((item) => {

            item.classList.remove("active");

        });


        button.classList.add("active");


        /*
            Later you can connect these
            buttons to your Go routes.

            Example:

            home    -> /dashboard
            tv      -> /tv-series
            movies  -> /movies
            anime   -> /anime
        */

        console.log(
            "Selected page:",
            button.dataset.page
        );

    });

});


/* =========================================================
   GENRE OPTIONS
   ========================================================= */

const genreOptions =
    document.querySelectorAll(".genre-option");


genreOptions.forEach((option) => {

    option.addEventListener("click", () => {

        const selectedGenre =
            option.textContent.trim();


        console.log(
            "Selected genre:",
            selectedGenre
        );


        /*
            Later this can become:

            /genre?action
            /genre?adventure
            /genre?comedy
            etc.
        */

    });

});


/* =========================================================
   SEARCH
   ========================================================= */

const searchInput =
    document.getElementById("dashboardSearch");

const searchButton =
    document.getElementById("searchButton");


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
        Later connect this to your Go backend.

        Example idea:

        window.location.href =
            "/search?q=" + encodeURIComponent(query);
    */

}


/* Search button */
searchButton.addEventListener(
    "click",
    performSearch
);


/* Search using Enter */
searchInput.addEventListener(
    "keydown",
    (event) => {

        if (event.key === "Enter") {

            performSearch();

        }

    }
);


/* =========================================================
   PROFILE BUTTON
   ========================================================= */

const profileButton =
    document.getElementById("profileButton");


profileButton.addEventListener(
    "click",
    () => {

        /*
            Later this can open:

            - Profile
            - Account settings
            - Saved movies
            - Security
            - Logout
        */

        console.log(
            "Profile clicked"
        );

    }
);


/* =========================================================
   PARTICLE BACKGROUND
   ========================================================= */

const canvas =
    document.getElementById("particleCanvas");

const context =
    canvas.getContext("2d");


let particles = [];

let animationFrame;


/* =========================================================
   CANVAS SIZE
   ========================================================= */

function resizeCanvas() {

    const devicePixelRatio =
        Math.min(window.devicePixelRatio || 1, 2);


    canvas.width =
        window.innerWidth * devicePixelRatio;

    canvas.height =
        window.innerHeight * devicePixelRatio;


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


    /*
        Keep mobile lighter than desktop.
    */

    let particleCount = 130;


    if (window.innerWidth < 720) {

        particleCount = 42;

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
                Math.random() * 1.5 + 0.35,

            velocityX:
                (Math.random() - 0.5) * 0.18,

            velocityY:
                (Math.random() - 0.5) * 1.18,

            opacity:
                Math.random() * 0.45 + 0.30

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


    /*
        Draw subtle connection lines.
        This gives the background a more
        cinematic "network / atmosphere" effect.
    */

    for (
        let i = 0;
        i < particles.length;
        i++
    ) {

        const particle =
            particles[i];


        /* -----------------------------------------
           Move particle
           ----------------------------------------- */

        particle.x +=
            particle.velocityX;

        particle.y +=
            particle.velocityY;


        /* -----------------------------------------
           Wrap particles around screen
           ----------------------------------------- */

        if (particle.x < -10) {

            particle.x =
                window.innerWidth + 10;

        }


        if (particle.x >
            window.innerWidth + 10
        ) {

            particle.x = -10;

        }


        if (particle.y < -10) {

            particle.y =
                window.innerHeight + 10;

        }


        if (particle.y >
            window.innerHeight + 10
        ) {

            particle.y = -10;

        }


        /* -----------------------------------------
           Draw particle
           ----------------------------------------- */

        context.beginPath();

        context.arc(
            particle.x,
            particle.y,
            particle.radius,
            0,
            Math.PI * 2
        );


        /*
            Muted sea-green / cyan atmosphere.
        */

        context.fillStyle =
            `rgba(102, 211, 207, ${particle.opacity})`;


        context.fill();


        /* -----------------------------------------
           Connect nearby particles
           ----------------------------------------- */

        for (
            let j = i + 1;
            j < particles.length;
            j++
        ) {

            const other =
                particles[j];


            const differenceX =
                particle.x - other.x;

            const differenceY =
                particle.y - other.y;


            const distance =
                Math.sqrt(
                    differenceX * differenceX +
                    differenceY * differenceY
                );


            if (distance < 105) {

                const opacity =
                    (1 - distance / 105) * 0.09;


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
                    `rgba(85, 170, 255, ${opacity})`;


                context.lineWidth = 0.7;

                context.stroke();

            }

        }

    }


    animationFrame =
        requestAnimationFrame(
            drawParticles
        );

}


/* =========================================================
   START BACKGROUND
   ========================================================= */

resizeCanvas();

drawParticles();


/* =========================================================
   RESIZE EVENT
   ========================================================= */

window.addEventListener(
    "resize",
    () => {

        resizeCanvas();

    }
);


/* =========================================================
   MOBILE RESIZE SAFETY
   ========================================================= */

window.addEventListener(
    "resize",
    () => {

        if (window.innerWidth > 720) {

            sidebar.classList.remove(
                "mobile-open"
            );

        }

    }
);