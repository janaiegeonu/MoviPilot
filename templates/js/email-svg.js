document.addEventListener("DOMContentLoaded", () => {

    const recoveryIcon =
        document.getElementById("recoveryIcon");

    if (!recoveryIcon) return;


    /*
        Small helper that lets us
        control the timing of each phase.
    */
    function wait(milliseconds) {

        return new Promise(resolve => {
            setTimeout(resolve, milliseconds);
        });

    }


    /*
        Remove every animation state.
    */
    function resetAnimation() {

        recoveryIcon.classList.remove(
            "mail-growing",
            "mail-vibrating",
            "mail-opening",
            "message-visible",
            "message-returning",
            "mail-closing",
            "notification"
        );

    }


    /*
        Main animation sequence.
    */
    async function playMailAnimation() {

        resetAnimation();


        /*
            Give the icon some breathing room
            before starting again.
        */
        await wait(1400);


        /*
            --------------------------------
            1. ENVELOPE GENTLY GROWS
            --------------------------------
        */

        recoveryIcon.classList.add(
            "mail-growing"
        );

        await wait(850);


        /*
            --------------------------------
            2. SMALL VIBRATION
            --------------------------------
        */

        recoveryIcon.classList.add(
            "mail-vibrating"
        );

        await wait(420);


        /*
            --------------------------------
            3. FLAP OPENS
            --------------------------------

            Notice that we're only opening
            .envelope-flap.

            The envelope body stays still.
        */

        recoveryIcon.classList.add(
            "mail-opening"
        );

        await wait(420);


        /*
            --------------------------------
            4. MESSAGE POPS OUT
            --------------------------------
        */

        recoveryIcon.classList.add(
            "message-visible"
        );

        recoveryIcon.classList.add(
            "notification"
        );

        await wait(750);


        /*
            --------------------------------
            5. HOLD XXXXXX
            --------------------------------
        */

        await wait(1700);


        /*
            Remove notification glow.
        */

        recoveryIcon.classList.remove(
            "notification"
        );


        /*
            --------------------------------
            6. MESSAGE SLIDES BACK INSIDE
            --------------------------------
        */

        recoveryIcon.classList.remove(
            "message-visible"
        );

        recoveryIcon.classList.add(
            "message-returning"
        );

        await wait(650);


        /*
            --------------------------------
            7. CLOSE ENVELOPE FLAP
            --------------------------------
        */

        recoveryIcon.classList.remove(
            "message-returning"
        );

        recoveryIcon.classList.remove(
            "mail-opening"
        );

        recoveryIcon.classList.add(
            "mail-closing"
        );

        await wait(720);


        /*
            --------------------------------
            8. RETURN TO NORMAL SIZE
            --------------------------------
        */

        recoveryIcon.classList.remove(
            "mail-growing",
            "mail-closing",
            "mail-vibrating"
        );


        /*
            Small pause before restarting.
        */

        await wait(1200);


        /*
            Start again.
        */

        playMailAnimation();

    }


    /*
        Start animation.
    */

    playMailAnimation();

});