// =========================================
// MOVIPILOT SIGNUP PAGE
// =========================================

document.addEventListener("DOMContentLoaded", () => {


    // =====================================
    // PASSWORD VISIBILITY
    // =====================================

    

    

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

    //password toggle


// This loops through all toggles on the page automatically
document.querySelectorAll('.password-toggle').forEach(button => {
    button.addEventListener('click', function() {
        // Reads "password" or "confirmPassword" dynamically based on the clicked button
        const targetId = this.getAttribute('data-target');
        const passwordInput = document.getElementById(targetId);
        
        if (!passwordInput) return;

        // Toggle input type
        const isPassword = passwordInput.type === 'password';
        passwordInput.type = isPassword ? 'text' : 'password';

        // Toggle icon state
        this.classList.toggle('is-visible', isPassword);

        // Update accessibility label
        this.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
    });
});

    

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