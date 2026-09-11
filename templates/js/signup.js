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
    // PASSWORD MATCH CHECK
    // =====================================

    const signupForm =
        document.getElementById("signupForm");

    const password =
        document.getElementById("password");

    const confirmPassword =
        document.getElementById("confirmPassword");


    /*
        Make sure all elements actually exist
        before trying to use them.
    */

    if (
        signupForm &&
        password &&
        confirmPassword
    ) {

        signupForm.addEventListener(
            "submit",
            (event) => {

                if (
                    password.value !==
                    confirmPassword.value
                ) {

                    event.preventDefault();

                    confirmPassword.focus();

                    confirmPassword.style.borderColor =
                        "#e45d6a";

                    confirmPassword.style.boxShadow =
                        "0 0 0 3px rgba(228, 93, 106, 0.10)";

                    return;
                }


                confirmPassword.style.borderColor =
                    "";

                confirmPassword.style.boxShadow =
                    "";

            }
        );


        // =================================
        // REMOVE ERROR WHILE TYPING
        // =================================

        confirmPassword.addEventListener(
            "input",
            () => {

                if (
                    password.value ===
                    confirmPassword.value
                ) {

                    confirmPassword.style.borderColor =
                        "";

                    confirmPassword.style.boxShadow =
                        "";

                }

            }
        );

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