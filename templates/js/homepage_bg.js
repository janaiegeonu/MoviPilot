console.log("MOVIPILOT DARK FLUID BACKGROUND LOADED");


const canvas = document.getElementById("particleCanvas");

if (!canvas) {

    console.error(
        "MoviPilot: particleCanvas was not found."
    );

} else {

    const ctx = canvas.getContext("2d");

    let width;
    let height;

    let animationTime = 0;

    let blobs = [];

    let stars = [];


    /* =========================================
       SETTINGS
    ========================================= */

    /*
        Fluid light fields.

        Keep this fairly low because we want
        the overall background to remain dark.
    */

    const blobCount = 7;


    /*
        Small background stars.
    */

    const starCount = 70;


    /*
        Overall fluid movement speed.
    */

    const movementSpeed = 0.00032;


    /* =========================================
       RESIZE
    ========================================= */

    function resizeCanvas() {

        width = window.innerWidth;
        height = window.innerHeight;


        const pixelRatio =
            Math.min(
                window.devicePixelRatio || 1,
                2
            );


        canvas.width =
            width * pixelRatio;

        canvas.height =
            height * pixelRatio;


        canvas.style.width =
            width + "px";

        canvas.style.height =
            height + "px";


        ctx.setTransform(
            pixelRatio,
            0,
            0,
            pixelRatio,
            0,
            0
        );
    }


    /* =========================================
       CREATE FLUID BLOBS
    ========================================= */

    function createBlobs() {

        blobs = [];


        for (
            let i = 0;
            i < blobCount;
            i++
        ) {

            blobs.push({

                x:
                    Math.random() *
                    width,

                y:
                    Math.random() *
                    height,


                radius:
                    Math.random() *
                    220 +
                    220,


                speedX:
                    Math.random() *
                    0.7 +
                    0.25,


                speedY:
                    Math.random() *
                    0.7 +
                    0.25,


                phaseX:
                    Math.random() *
                    Math.PI * 2,


                phaseY:
                    Math.random() *
                    Math.PI * 2,


                travelX:
                    Math.random() *
                    width * 0.25 +
                    width * 0.08,


                travelY:
                    Math.random() *
                    height * 0.25 +
                    height * 0.08,


                /*
                    Each blob gets a dark
                    cinematic color.
                */

                color:
                    i % 4
            });
        }
    }


    /* =========================================
       CREATE STARFIELD
    ========================================= */

    function createStars() {

        stars = [];


        for (
            let i = 0;
            i < starCount;
            i++
        ) {

            stars.push({

                x:
                    Math.random() *
                    width,

                y:
                    Math.random() *
                    height,


                size:
                    Math.random() *
                    1.3 +
                    0.3,


                opacity:
                    Math.random() *
                    0.35 +
                    0.08,


                twinkle:
                    Math.random() *
                    Math.PI * 2,


                twinkleSpeed:
                    Math.random() *
                    0.015 +
                    0.005,


                /*
                    Very slow movement.
                */

                speed:
                    Math.random() *
                    0.08 +
                    0.02
            });
        }
    }


    /* =========================================
       DARK CINEMATIC COLORS
    ========================================= */

    function getBlobColor(blob) {

        /*
            Deep navy
        */

        if (blob.color === 0) {

            return {
                r: 5,
                g: 35,
                b: 95
            };
        }


        /*
            Deep blue
        */

        if (blob.color === 1) {

            return {
                r: 5,
                g: 50,
                b: 125
            };
        }


        /*
            Dark indigo
        */

        if (blob.color === 2) {

            return {
                r: 30,
                g: 25,
                b: 105
            };
        }


        /*
            Midnight blue
        */

        return {
            r: 8,
            g: 30,
            b: 75
        };
    }


    /* =========================================
       DRAW FLUID BLOB
    ========================================= */

    function drawBlob(blob, time) {

        const x =
            blob.x +
            Math.sin(
                time *
                movementSpeed *
                blob.speedX +
                blob.phaseX
            ) *
            blob.travelX;


        const y =
            blob.y +
            Math.cos(
                time *
                movementSpeed *
                blob.speedY +
                blob.phaseY
            ) *
            blob.travelY;


        /*
            Gentle breathing.
        */

        const breathing =
            Math.sin(
                time *
                movementSpeed *
                1.5 +
                blob.phaseX
            );


        const radius =
            blob.radius *
            (
                0.90 +
                breathing * 0.10
            );


        const color =
            getBlobColor(blob);


        /*
            Dark but visible glow.
        */

        const gradient =
            ctx.createRadialGradient(
                x,
                y,
                0,
                x,
                y,
                radius
            );


        gradient.addColorStop(
            0,
            `rgba(
                ${color.r},
                ${color.g},
                ${color.b},
                0.34
            )`
        );


        gradient.addColorStop(
            0.35,
            `rgba(
                ${color.r},
                ${color.g},
                ${color.b},
                0.18
            )`
        );


        gradient.addColorStop(
            0.70,
            `rgba(
                ${color.r},
                ${color.g},
                ${color.b},
                0.07
            )`
        );


        gradient.addColorStop(
            1,
            `rgba(
                ${color.r},
                ${color.g},
                ${color.b},
                0
            )`
        );


        ctx.beginPath();

        ctx.fillStyle =
            gradient;

        ctx.arc(
            x,
            y,
            radius,
            0,
            Math.PI * 2
        );

        ctx.fill();
    }


    /* =========================================
       FLUID FIELD
    ========================================= */

    function drawFluidField(time) {

        /*
            Heavy blur makes the separate
            blobs blend into one fluid
            abstract atmosphere.
        */

        ctx.filter =
            "blur(45px)";


        for (
            let i = 0;
            i < blobs.length;
            i++
        ) {

            drawBlob(
                blobs[i],
                time
            );
        }


        ctx.filter =
            "none";
    }


    /* =========================================
       DARK FLOWING WAVES
    ========================================= */

    function drawFlowingLight(time) {

        ctx.save();


        ctx.globalCompositeOperation =
            "screen";


        ctx.filter =
            "blur(35px)";


        for (
            let i = 0;
            i < 3;
            i++
        ) {

            ctx.beginPath();


            const baseY =
                height *
                (
                    0.25 +
                    i * 0.30
                );


            for (
                let x = -100;
                x <= width + 100;
                x += 20
            ) {

                const wave =
                    Math.sin(
                        x * 0.002 +
                        time *
                        movementSpeed *
                        (1 + i * 0.3)
                    ) *
                    110;


                const secondWave =
                    Math.sin(
                        x * 0.004 -
                        time *
                        movementSpeed *
                        0.7
                    ) *
                    45;


                const y =
                    baseY +
                    wave +
                    secondWave;


                if (x === -100) {

                    ctx.moveTo(
                        x,
                        y
                    );

                } else {

                    ctx.lineTo(
                        x,
                        y
                    );
                }
            }


            /*
                Extremely dark flowing
                light.
            */

            if (i === 0) {

                ctx.strokeStyle =
                    "rgba(10, 60, 140, 0.07)";

            } else if (i === 1) {

                ctx.strokeStyle =
                    "rgba(25, 45, 130, 0.06)";

            } else {

                ctx.strokeStyle =
                    "rgba(5, 40, 100, 0.05)";
            }


            ctx.lineWidth =
                110;


            ctx.stroke();
        }


        ctx.restore();
    }


    /* =========================================
       STARFIELD
    ========================================= */

    function drawStars(time) {

        for (
            let i = 0;
            i < stars.length;
            i++
        ) {

            const star =
                stars[i];


            /*
                Tiny vertical drift.
            */

            star.y -=
                star.speed;


            /*
                Wrap around the screen.
            */

            if (star.y < -5) {

                star.y =
                    height + 5;

                star.x =
                    Math.random() *
                    width;
            }


            /*
                Gentle twinkle.
            */

            star.twinkle +=
                star.twinkleSpeed;


            const twinkle =
                Math.sin(
                    star.twinkle
                );


            const opacity =
                star.opacity *
                (
                    0.65 +
                    twinkle * 0.35
                );


            /*
                Tiny blue-white point.
            */

            ctx.beginPath();

            ctx.fillStyle =
                `rgba(
                    150,
                    190,
                    230,
                    ${opacity}
                )`;


            ctx.arc(
                star.x,
                star.y,
                star.size,
                0,
                Math.PI * 2
            );


            ctx.fill();
        }
    }


    /* =========================================
       MAIN ANIMATION
    ========================================= */

    function animate() {

        /*
            Clear previous frame.
        */

        ctx.clearRect(
            0,
            0,
            width,
            height
        );


        /*
            Advance animation clock.
        */

        animationTime += 1;


        /*
            Stars first.
        */

        drawStars(
            animationTime
        );


        /*
            Fluid atmosphere.
        */

        drawFluidField(
            animationTime
        );


        /*
            Broad flowing light.
        */

        drawFlowingLight(
            animationTime
        );


        /*
            Continue animation.
        */

        requestAnimationFrame(
            animate
        );
    }


    /* =========================================
       RESIZE
    ========================================= */

    window.addEventListener(
        "resize",
        function () {

            resizeCanvas();

            createBlobs();

            createStars();
        }
    );


    /* =========================================
       START
    ========================================= */

    resizeCanvas();

    createBlobs();

    createStars();

    animate();
}