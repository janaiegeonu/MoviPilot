document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("verificationForm");
    const wrapper = document.getElementById("codeInputWrapper");
    const cluster = document.getElementById("codeCluster");
    const inputs = [...document.querySelectorAll(".code-input")];
    const hiddenCode = document.getElementById("verificationCode");

    const errorBox = document.getElementById("verificationError");
    const errorText = document.getElementById("verificationErrorText");

    const resendButton = document.getElementById("resendCode");

    const verifyButton = document.getElementById("verifyButton");
    const verifyButtonText = verifyButton?.querySelector(".verify-button-text");

    const status = document.getElementById("verificationStatus");

    if (
        !form ||
        !wrapper ||
        !cluster ||
        inputs.length !== 6 ||
        !hiddenCode ||
        !errorBox ||
        !errorText ||
        !verifyButton
    ) {
        console.error("MoviPilot verification UI could not initialize.");
        return;
    }


    /* =====================================================
       HELPERS
       ===================================================== */

    function wait(milliseconds) {
        return new Promise((resolve) => {
            window.setTimeout(resolve, milliseconds);
        });
    }

    function getCode() {
        return inputs.map((input) => input.value).join("");
    }

    function isCompleteCode(code) {
        return /^\d{6}$/.test(code);
    }

    function syncHiddenCode() {
        hiddenCode.value = getCode();
    }

    function updateButtonState() {
        const complete = isCompleteCode(getCode());

        if (!wrapper.classList.contains("checking")) {
            verifyButton.disabled = !complete;
        }
    }

    function clearError() {
        errorBox.classList.remove("visible");
        wrapper.classList.remove("error", "shake");
    }

    function showError(message) {
        errorText.textContent = message;
        errorBox.classList.add("visible");
        wrapper.classList.add("error");
    }

    function clearMergePositions() {
        inputs.forEach((input) => {
            input.style.removeProperty("--merge-x");
        });
    }

    function calculateMergePositions() {
        const wrapperRect = wrapper.getBoundingClientRect();
        const wrapperCenter = wrapperRect.left + wrapperRect.width / 2;

        inputs.forEach((input) => {
            const inputRect = input.getBoundingClientRect();
            const inputCenter = inputRect.left + inputRect.width / 2;
            const mergeDistance = wrapperCenter - inputCenter;

            input.style.setProperty(
                "--merge-x",
                `${mergeDistance}px`
            );
        });
    }

    function setButtonLoading(loading) {
        verifyButton.disabled = loading;
        verifyButton.classList.toggle("loading", loading);

        if (verifyButtonText) {
            verifyButtonText.textContent = loading
                ? "Checking code..."
                : "Verify email";
        }
    }

    function setButtonSuccess() {
        verifyButton.classList.remove("loading");
        verifyButton.classList.add("success-state");
        verifyButton.disabled = true;

        if (verifyButtonText) {
            verifyButtonText.textContent = "Code verified";
        }
    }

    function prepareInputsForChecking() {
        /*
            Measure first, while the six boxes are still
            in their normal positions.

            That gives every box its exact distance to
            the middle of the wrapper, so the merge works
            on desktop and mobile without hard-coded pixels.
        */
        calculateMergePositions();

        clearError();

        inputs.forEach((input) => {
            input.disabled = true;
        });

        if (resendButton) {
            resendButton.disabled = true;
        }

        verifyButton.disabled = true;
        setButtonLoading(true);

        /*
            The CSS now moves every box toward the same
            center point and morphs the middle into a circle.
        */
        wrapper.classList.add("checking");

        void status?.offsetWidth;
    }

    function restoreInputsAfterFailure() {
        wrapper.classList.remove("checking", "failure", "success");
        wrapper.classList.add("error");

        /*
            Let the boxes finish spreading back out before
            starting the rejection shake.
        */
        window.setTimeout(() => {
            wrapper.classList.add("shake");

            window.setTimeout(() => {
                wrapper.classList.remove("shake");
            }, 560);
        }, 620);

        inputs.forEach((input) => {
            input.disabled = false;
            input.value = "";
        });

        syncHiddenCode();
        clearMergePositions();

        verifyButton.classList.remove(
            "loading",
            "success-state"
        );

        verifyButton.disabled = true;

        if (verifyButtonText) {
            verifyButtonText.textContent = "Verify email";
        }

        if (resendButton) {
            resendButton.disabled = false;
        }

        inputs[0].focus();
    }

    async function animateFailure(message) {
        /*
            Keep the spinner visible slightly after the server
            response so the user experiences this as one
            continuous "checking" operation.
        */
        wrapper.classList.add("failure");

        await wait(520);

        /*
            Remove checking -> the circle contracts and
            the six boxes smoothly return to their positions.
        */
        restoreInputsAfterFailure();

        await wait(700);

        showError(message);
    }

    async function animateSuccess(redirectURL) {
        /*
            Replace the spinner with the green success
            circle and animate the SVG check mark.
        */
        wrapper.classList.add("success");

        setButtonSuccess();

        await wait(1250);

        window.location.assign(
            redirectURL || "/reset-password"
        );
    }


    /* =====================================================
       INPUT HANDLING
       ===================================================== */

    inputs.forEach((input, index) => {
        input.addEventListener("input", () => {
            if (wrapper.classList.contains("checking")) {
                return;
            }

            clearError();

            /*
                Keep only the last numeric character entered.
                This protects the one-character UI even if a
                browser tries to inject multiple characters.
            */
            const digits = input.value.replace(/\D/g, "");

            input.value = digits.slice(-1);

            if (input.value && index < inputs.length - 1) {
                inputs[index + 1].focus();
            }

            syncHiddenCode();
            updateButtonState();
        });


        input.addEventListener("keydown", (event) => {
            if (wrapper.classList.contains("checking")) {
                event.preventDefault();
                return;
            }

            if (event.key === "Backspace" && !input.value && index > 0) {
                inputs[index - 1].focus();
                inputs[index - 1].value = "";

                syncHiddenCode();
                updateButtonState();
            }


            if (event.key === "ArrowLeft" && index > 0) {
                event.preventDefault();
                inputs[index - 1].focus();
            }


            if (event.key === "ArrowRight" && index < inputs.length - 1) {
                event.preventDefault();
                inputs[index + 1].focus();
            }


            if (event.key === " " || event.key === "e" || event.key === "E") {
                event.preventDefault();
            }
        });


        input.addEventListener("paste", (event) => {
            if (wrapper.classList.contains("checking")) {
                event.preventDefault();
                return;
            }

            event.preventDefault();

            const pasted = (
                event.clipboardData?.getData("text") || ""
            ).replace(/\D/g, "").slice(0, 6);

            if (!pasted) {
                return;
            }

            inputs.forEach((box, boxIndex) => {
                box.value = pasted[boxIndex] || "";
            });

            syncHiddenCode();

            const lastFilledIndex = Math.min(
                pasted.length - 1,
                inputs.length - 1
            );

            inputs[lastFilledIndex].focus();

            updateButtonState();
        });
    });


    /* =====================================================
       VERIFICATION
       ===================================================== */

    form.addEventListener("submit", async (event) => {
        event.preventDefault();

        if (wrapper.classList.contains("checking")) {
            return;
        }

        const code = getCode();

        syncHiddenCode();

        if (!isCompleteCode(code)) {
            showError("Please enter the 6-digit verification code.");
            wrapper.classList.remove("shake");

            void wrapper.offsetWidth;

            wrapper.classList.add("shake");

            window.setTimeout(() => {
                wrapper.classList.remove("shake");
            }, 560);

            return;
        }

        prepareInputsForChecking();

        try {
            const response = await fetch(
                "/verify-code",
                {
                    method: "POST",
                    headers: {
                        "Content-Type":
                            "application/x-www-form-urlencoded; charset=UTF-8",
                        "Accept": "application/json"
                    },
                    body: new URLSearchParams({
                        verification_code: code
                    }).toString()
                }
            );

            let data = null;

            try {
                data = await response.json();
            } catch (jsonError) {
                throw new Error(
                    "The server returned an unexpected response."
                );
            }

            if (!response.ok || !data.success) {
                throw new Error(
                    data?.error ||
                    "The verification code is invalid or has expired."
                );
            }

            await animateSuccess(
                data.redirect || "/reset-password"
            );

        } catch (error) {
            console.error(
                "Verification request failed:",
                error
            );

            await animateFailure(
                error.message ||
                "The verification code is invalid or has expired."
            );
        }
    });


    /* =====================================================
       RESEND CODE
       ===================================================== */

    let resendTimer = null;

    function startResendCooldown(seconds = 30) {
        if (!resendButton) {
            return;
        }

        let remaining = seconds;

        resendButton.disabled = true;
        resendButton.classList.add("cooldown");
        resendButton.textContent =
            `Resend in ${remaining}s`;

        window.clearInterval(resendTimer);

        resendTimer = window.setInterval(() => {
            remaining -= 1;

            if (remaining <= 0) {
                window.clearInterval(resendTimer);

                resendButton.disabled = false;
                resendButton.classList.remove("cooldown");
                resendButton.textContent = "Resend code";

                return;
            }

            resendButton.textContent =
                `Resend in ${remaining}s`;
        }, 1000);
    }


    if (resendButton) {
        resendButton.addEventListener("click", async () => {
            if (
                resendButton.disabled ||
                wrapper.classList.contains("checking")
            ) {
                return;
            }

            const email = form.dataset.email?.trim();

            if (!email) {
                showError(
                    "Your verification session has expired. Please request a new code."
                );
                return;
            }

            resendButton.disabled = true;
            resendButton.textContent = "Sending...";

            try {
                const response = await fetch(
                    "/forgot-password",
                    {
                        method: "POST",
                        headers: {
                            "Content-Type":
                                "application/x-www-form-urlencoded; charset=UTF-8",
                            "Accept": "application/json"
                        },
                        body: new URLSearchParams({ email }).toString()
                    }
                );

                const data = await response.json();

                if (!response.ok || !data.success) {
                    throw new Error(
                        data?.error ||
                        "We couldn't resend the verification code."
                    );
                }

                inputs.forEach((input) => {
                    input.value = "";
                });

                syncHiddenCode();
                clearError();
                updateButtonState();

                resendButton.textContent = "Code sent ✓";

                await wait(900);

                startResendCooldown(30);

                inputs[0].focus();

            } catch (error) {
                console.error(
                    "Resend request failed:",
                    error
                );

                resendButton.disabled = false;
                resendButton.textContent = "Resend code";

                showError(
                    error.message ||
                    "We couldn't resend the verification code."
                );
            }
        });
    }


    /* =====================================================
       INITIAL STATE
       ===================================================== */

    syncHiddenCode();
    updateButtonState();

    if (inputs[0] && !inputs[0].disabled) {
        inputs[0].focus();
    }
});