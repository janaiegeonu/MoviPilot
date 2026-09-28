document.addEventListener("DOMContentLoaded", () => {

    // =====================================
    // PASSWORD VISIBILITY (FIXED & CLEANED)
    // =====================================
    const passwordToggles = document.querySelectorAll(".password-toggle");

    passwordToggles.forEach((button) => {
        button.addEventListener("click", () => {
            const targetId = button.getAttribute("data-target");
            const input = document.getElementById(targetId);

            if (!input) return;

            // Check if it's currently a password type
            const isPassword = input.type === "password";

            // Toggle input type
            input.type = isPassword ? "text" : "password";

            // Toggle the CSS class on the button so the SVGs can switch
            button.classList.toggle("is-visible", isPassword);

            // Update accessibility label
            button.setAttribute(
                "aria-label",
                isPassword ? "Hide password" : "Show password"
            );
        });
    });


    // =====================================
    // PASSWORD MATCH CHECK
    // =====================================
    const signupForm = document.getElementById("signupForm");
    const password = document.getElementById("password");
    const confirmPassword = document.getElementById("confirmPassword");

    /*
        Make sure all elements actually exist before trying to use them.
    */
    if (signupForm && password && confirmPassword) {

        signupForm.addEventListener("submit", (event) => {
            if (password.value !== confirmPassword.value) {
                event.preventDefault();
                confirmPassword.focus();
                confirmPassword.style.borderColor = "#e45d6a";
                confirmPassword.style.boxShadow = "0 0 0 3px rgba(228, 93, 106, 0.10)";
                return;
            }

            confirmPassword.style.borderColor = "";
            confirmPassword.style.boxShadow = "";
        });

        // =================================
        // REMOVE ERROR WHILE TYPING
        // =================================
        confirmPassword.addEventListener("input", () => {
            if (password.value === confirmPassword.value) {
                confirmPassword.style.borderColor = "";
                confirmPassword.style.boxShadow = "";
            }
        });
    }


    // =====================================
    // GOOGLE SIGNUP
    // =====================================
    const googleSignup = document.getElementById("googleSignup");

    if (googleSignup) {
        googleSignup.addEventListener("click", () => {
            console.log("Google signup selected");
            /*
                Later we will replace this with the actual Google authentication process.
            */
        });
    }

});
