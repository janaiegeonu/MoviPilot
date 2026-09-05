const canvas = document.getElementById("particleCanvas");
const ctx = canvas.getContext("2d");

let width;
let height;

let particles = [];

let mouseX = 0;
let mouseY = 0;


/* Resize canvas*/

function resizeCanvas() {

    width = window.innerWidth;
    height = window.innerHeight;

    const pixelRatio = Math.min(window.devicePixelRatio, 2);

    canvas.width = width * pixelRatio;
    canvas.height = height * pixelRatio;

    canvas.style.width = width + "px";
    canvas.style.height = height + "px";

    ctx.setTransform(
        pixelRatio,
        0,
        0,
        pixelRatio,
        0,
        0
    );
}


/* Particle*/

class Particle {

    constructor() {

        this.reset(true);
    }


    reset(initial = false) {

        this.x = Math.random() * width;

        this.y = initial
            ? Math.random() * height
            : height + Math.random() * 100;


        /*
            Depth simulation.

            Large z = closer
            Small z = farther
        */

        this.z = Math.random();


        /*
            Particle size depends
            on its depth.
        */

        this.size =
            0.5 +
            this.z * 2.2;


        /*
            Slow cinematic movement
        */

        this.speedX =
            (Math.random() - 0.5) *
            (0.15 + this.z * 0.35);


        this.speedY =
            -(0.05 + this.z * 0.25);


        /*
            Random opacity
        */

        this.opacity =
            0.15 +
            this.z * 0.65;


        /*
            Some particles are
            brighter than others.
        */

        this.glow =
            Math.random() > 0.82;


        /*
            Slight twinkle animation
        */

        this.twinkle =
            Math.random() * Math.PI * 2;


        this.twinkleSpeed =
            0.005 +
            Math.random() * 0.015;
    }


    update() {

        this.x += this.speedX;
        this.y += this.speedY;


        /*
            Very subtle mouse
            parallax effect.
        */

        const parallaxX =
            (mouseX - width / 2) *
            0.00008 *
            this.z;

        const parallaxY =
            (mouseY - height / 2) *
            0.00008 *
            this.z;

        this.x += parallaxX;
        this.y += parallaxY;


        /*
            Twinkle
        */

        this.twinkle += this.twinkleSpeed;


        /*
            If particle leaves
            the screen, bring it
            back from the bottom.
        */

        if (
            this.y < -20 ||
            this.x < -50 ||
            this.x > width + 50
        ) {

            this.reset();
        }
    }


    draw() {

        /*
            Small variation in opacity
            creates subtle shimmering.
        */

        const shimmer =
            0.75 +
            Math.sin(this.twinkle) * 0.25;

        const alpha =
            this.opacity * shimmer;


        ctx.beginPath();

        ctx.arc(
            this.x,
            this.y,
            this.size,
            0,
            Math.PI * 2
        );


        /*
            Most particles are
            soft blue-white.
        */

        ctx.fillStyle =
            `rgba(120, 190, 255, ${alpha})`;

        ctx.fill();


        /*
            Only some particles
            receive a cinematic glow.
        */

        if (this.glow) {

            ctx.beginPath();

            ctx.arc(
                this.x,
                this.y,
                this.size * 4,
                0,
                Math.PI * 2
            );


            const glow =
                ctx.createRadialGradient(
                    this.x,
                    this.y,
                    0,
                    this.x,
                    this.y,
                    this.size * 4
                );


            glow.addColorStop(
                0,
                `rgba(60, 160, 255, ${alpha * 0.35})`
            );

            glow.addColorStop(
                1,
                "rgba(0, 80, 255, 0)"
            );


            ctx.fillStyle = glow;

            ctx.fill();
        }
    }
}


/* Create particles*/

function createParticles() {

    particles = [];


    /*
        Adjust number based
        on screen size.

        Desktop:
        ~130 particles

        Mobile:
        ~60 particles
    */

    const particleCount =
        Math.min(
            160,
            Math.max(
                60,
                Math.floor(
                    (width * height) / 10000
                )
            )
        );


    for (let i = 0; i < particleCount; i++) {

        particles.push(
            new Particle()
        );
    }
}


/* 
   Animation loop
 */

function animate() {

    ctx.clearRect(
        0,
        0,
        width,
        height
    );


    for (const particle of particles) {

        particle.update();

        particle.draw();
    }


    requestAnimationFrame(animate);
}


/* Mouse interaction */

window.addEventListener(
    "mousemove",
    (event) => {

        mouseX = event.clientX;

        mouseY = event.clientY;
    }
);


/* Window resize */

window.addEventListener(
    "resize",
    () => {

        resizeCanvas();

        createParticles();
    }
);


/* Start */

resizeCanvas();

createParticles();

animate();