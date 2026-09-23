document.addEventListener("DOMContentLoaded", () => {

    /*
     * =====================================================
     * ELEMENTS
     * =====================================================
     */

    const form =
        document.getElementById("verificationForm");

    const inputs =
        document.querySelectorAll(".code-input");

    const wrapper =
        document.getElementById("codeInputWrapper");

    const hiddenCode =
        document.getElementById("verificationCode");

    const verifyButton =
        document.getElementById("verifyButton");

    const errorBox =
        document.getElementById("verificationError");

    const errorText =
        document.getElementById("verificationErrorText");

    const resendButton =
        document.getElementById("resendCode");


    /*
     * Safety check
     */

    if (
        !form ||
        !inputs.length ||
        !hiddenCode ||
        !verifyButton
    ) {
        return;
    }


    /*
     * Convert NodeList into an array.
     */

    const codeInputs =
        Array.from(inputs);


    /*
     * =====================================================
     * GET COMPLETE CODE
     * =====================================================
     */

    function getCode() {

        return codeInputs
            .map(input => input.value)
            .join("");

    }


    /*
     * =====================================================
     * UPDATE HIDDEN INPUT
     * =====================================================
     *
     * This allows Go to receive:
     *
     * verification_code=123456
     *
     * instead of six separate values.
     */

    function updateCode() {

        hiddenCode.value =
            getCode();

    }


    /*
     * =====================================================
     * CHECK WHETHER CODE IS COMPLETE
     * =====================================================
     */

    function updateVerifyButton() {

        const code =
            getCode();

        const complete =
            code.length === 6 &&
            /^\d{6}$/.test(code);

        verifyButton.disabled =
            !complete;

    }


    /*
     * =====================================================
     * CLEAR ERROR
     * =====================================================
     */

    function clearError() {

        errorBox.classList.remove(
            "show"
        );

    }


    /*
     * =====================================================
     * SHOW ERROR
     * =====================================================
     */

    function showError(message) {

        errorText.textContent =
            message;

        errorBox.classList.add(
            "show"
        );

        wrapper.classList.remove(
            "shake"
        );

        /*
         * Force browser to restart
         * the shake animation.
         */

        void wrapper.offsetWidth;

        wrapper.classList.add(
            "shake"
        );

    }


    /*
     * =====================================================
     * INPUT HANDLING
     * =====================================================
     */

    codeInputs.forEach((input, index) => {


        /*
         * ---------------------------------------------
         * TYPING
         * ---------------------------------------------
         */

        input.addEventListener(
            "input",
            () => {

                /*
                 * Keep only numbers.
                 */

                input.value =
                    input.value.replace(
                        /\D/g,
                        ""
                    );


                /*
                 * Only keep one digit.
                 */

                if (
                    input.value.length > 1
                ) {

                    input.value =
                        input.value.charAt(0);

                }


                /*
                 * Style filled box.
                 */

                if (input.value) {

                    input.classList.add(
                        "filled"
                    );

                    /*
                     * Automatically move
                     * to next input.
                     */

                    if (
                        index <
                        codeInputs.length - 1
                    ) {

                        codeInputs[
                            index + 1
                        ].focus();

                    }

                } else {

                    input.classList.remove(
                        "filled"
                    );

                }


                clearError();

                updateCode();

                updateVerifyButton();

            }
        );


        /*
         * ---------------------------------------------
         * KEYBOARD
         * ---------------------------------------------
         */

        input.addEventListener(
            "keydown",
            event => {


                /*
                 * Backspace
                 */

                if (
                    event.key === "Backspace" &&
                    !input.value &&
                    index > 0
                ) {

                    codeInputs[
                        index - 1
                    ].focus();

                    codeInputs[
                        index - 1
                    ].value = "";

                    codeInputs[
                        index - 1
                    ].classList.remove(
                        "filled"
                    );

                    updateCode();

                    updateVerifyButton();

                }


                /*
                 * Arrow left
                 */

                if (
                    event.key === "ArrowLeft" &&
                    index > 0
                ) {

                    codeInputs[
                        index - 1
                    ].focus();

                }


                /*
                 * Arrow right
                 */

                if (
                    event.key === "ArrowRight" &&
                    index <
                    codeInputs.length - 1
                ) {

                    codeInputs[
                        index + 1
                    ].focus();

                }

            }
        );


        /*
         * ---------------------------------------------
         * PASTE
         * ---------------------------------------------
         */

        input.addEventListener(
            "paste",
            event => {

                event.preventDefault();

                const pasted =
                    (
                        event.clipboardData ||
                        window.clipboardData
                    )
                    .getData("text")
                    .replace(/\D/g, "")
                    .slice(0, 6);


                if (!pasted) {
                    return;
                }


                /*
                 * Fill each box.
                 */

                pasted
                    .split("")
                    .forEach(
                        (digit, digitIndex) => {

                            if (
                                codeInputs[
                                    digitIndex
                                ]
                            ) {

                                codeInputs[
                                    digitIndex
                                ].value =
                                    digit;

                                codeInputs[
                                    digitIndex
                                ].classList.add(
                                    "filled"
                                );

                            }

                        }
                    );


                /*
                 * Focus the appropriate
                 * next box.
                 */

                const nextIndex =
                    Math.min(
                        pasted.length,
                        5
                    );

                codeInputs[
                    nextIndex
                ].focus();


                clearError();

                updateCode();

                updateVerifyButton();

            }
        );


        /*
         * ---------------------------------------------
         * FOCUS
         * ---------------------------------------------
         */

        input.addEventListener(
            "focus",
            () => {

                clearError();

            }
        );

    });


    /*
     * =====================================================
     * FORM SUBMISSION
     * =====================================================
     */

    form.addEventListener(
        "submit",
        event => {

            const code =
                getCode();


            /*
             * Don't submit incomplete code.
             */

            if (
                code.length !== 6 ||
                !/^\d{6}$/.test(code)
            ) {

                event.preventDefault();

                showError(
                    "Please enter the complete 6-digit code."
                );

                /*
                 * Focus first empty input.
                 */

                const emptyInput =
                    codeInputs.find(
                        input =>
                            !input.value
                    );

                if (emptyInput) {

                    emptyInput.focus();

                }

                return;

            }


            /*
             * Put final code into hidden input.
             */

            hiddenCode.value =
                code;


            /*
             * Allow the Go server
             * to process the form.
             */

            verifyButton.classList.add(
                "loading"
            );

            verifyButton.disabled =
                true;

        }
    );


    /*
     * =====================================================
     * RESEND CODE
     * =====================================================
     *
     * This currently demonstrates the UI.
     *
     * Later your Go handler can be connected here.
     */

    if (resendButton) {

        resendButton.addEventListener(
            "click",
            async () => {

                /*
                 * Prevent multiple clicks.
                 */

                resendButton.disabled =
                    true;

                const originalText =
                    resendButton.textContent;

                resendButton.textContent =
                    "Sending...";


                /*
                 * -----------------------------------------
                 * TEMPORARY DEMO DELAY
                 * -----------------------------------------
                 *
                 * Later replace this section with
                 * fetch("/resend-code", ...)
                 */

                await new Promise(
                    resolve =>
                        setTimeout(
                            resolve,
                            1200
                        )
                );


                resendButton.textContent =
                    "Code sent";


                /*
                 * Give user a short period
                 * before allowing another resend.
                 */

                await new Promise(
                    resolve =>
                        setTimeout(
                            resolve,
                            3000
                        )
                );


                resendButton.textContent =
                    originalText;

                resendButton.disabled =
                    false;

            }
        );

    }


    /*
     * =====================================================
     * INITIAL FOCUS
     * =====================================================
     */

    setTimeout(
        () => {

            codeInputs[0].focus();

        },
        600
    );


    /*
     * Initial state.
     */

    updateCode();

    updateVerifyButton();

});