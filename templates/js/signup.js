// =========================================
// MOVIPILOT SIGNUP PAGE
// =========================================

document.addEventListener("DOMContentLoaded", () => {


    // =====================================
    // PASSWORD VISIBILITY
    // =====================================

    const passwordToggles =
        document.querySelectorAll(".password-toggle");


    passwordToggles.forEach((button) => {

        button.addEventListener("click", () => {

            const targetId =
                button.getAttribute("data-target");

            const input =
                document.getElementById(targetId);


            if (!input) {
                return;
            }


            if (input.type === "password") {

                input.type = "text";

                button.setAttribute(
                    "aria-label",
                    "Hide password"
                );

            } else {

                input.type = "password";

                button.setAttribute(
                    "aria-label",
                    "Show password"
                );

            }

        });

    });

    

    // =====================================
    // PRESERVE PASSWORD DURING VALIDATION
    // =====================================

    const password =
        document.getElementById("password");

    const confirmPassword =
        document.getElementById("confirmPassword");

    const signupForm =
        document.getElementById("signupForm");


    // Restore saved password
    // after the page is re-rendered.

    if (password) {

        const savedPassword =
            sessionStorage.getItem("movipilotPassword");

        if (savedPassword) {
            password.value = savedPassword;
        }
    }


    // Restore saved confirm password

    if (confirmPassword) {

        const savedConfirmPassword =
            sessionStorage.getItem("movipilotConfirmPassword");

        if (savedConfirmPassword) {
            confirmPassword.value =
                savedConfirmPassword;
        }
    }


    // Save password before normal form submission

    if (signupForm) {

        signupForm.addEventListener("submit", () => {

            if (password) {

                sessionStorage.setItem(
                    "movipilotPassword",
                    password.value
                );

            }


            if (confirmPassword) {

                sessionStorage.setItem(
                    "movipilotConfirmPassword",
                    confirmPassword.value
                );

            }

        });

    }


    // =====================================
    // GOOGLE SIGNUP
    // =====================================

    const googleSignup =
        document.getElementById("googleSignup");


    if (googleSignup) {

        googleSignup.addEventListener(
            "click",
            () => {

                console.log(
                    "Google signup selected"
                );

                /*
                    Later we will replace this
                    with the actual Google
                    authentication process.
                */

            }
        );

    }


});