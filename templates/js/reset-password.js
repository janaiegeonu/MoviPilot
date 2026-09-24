document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("resetPasswordForm");
    const password = document.getElementById("newPassword");
    const confirmPassword = document.getElementById("confirmPassword");
    const passwordError = document.getElementById("passwordError");
    const confirmPasswordError = document.getElementById("confirmPasswordError");
    const resetButton = document.getElementById("resetButton");
    const toggleButtons = document.querySelectorAll(".password-toggle");

    if (!form || !password || !confirmPassword || !resetButton) return;

    toggleButtons.forEach(button => {
        button.addEventListener("click", () => {
            const target = document.getElementById(button.dataset.target);
            if (!target) return;

            const showing = target.type === "text";
            target.type = showing ? "password" : "text";
            button.classList.toggle("visible", !showing);
            button.setAttribute("aria-label", showing ? "Show password" : "Hide password");
            target.focus();
        });
    });

    function clearFieldError(input, errorElement) {
        input.classList.remove("input-error");
        errorElement.textContent = "";
        errorElement.classList.remove("visible");
    }

    function showFieldError(input, errorElement, message) {
        input.classList.remove("input-success");
        input.classList.add("input-error");
        errorElement.textContent = message;
        errorElement.classList.add("visible");

        
    }

    function clearAllErrors() {
        clearFieldError(password, passwordError);
        clearFieldError(confirmPassword, confirmPasswordError);
    }

    function validatePassword(value) {
        if (value.length < 8) return "Password must be at least 8 characters";

        let hasDigit = false;
        let hasLetter = false;

        for (const char of value) {
            if (/\d/.test(char)) hasDigit = true;
            if (/[A-Za-z]/.test(char)) hasLetter = true;
        }

        if (!hasDigit) return "Password must contain at least one number";
        if (!hasLetter) return "Password must contain at least one letter";
        return "";
    }

    function checkPasswordMatch() {
        confirmPassword.classList.remove("input-success");

        if (!confirmPassword.value) {
            clearFieldError(confirmPassword, confirmPasswordError);
            return true;
        }

        if (password.value !== confirmPassword.value) {
            showFieldError(confirmPassword, confirmPasswordError, "Passwords do not match");
            return false;
        }

        clearFieldError(confirmPassword, confirmPasswordError);
        confirmPassword.classList.add("input-success");
        return true;
    }

    password.addEventListener("input", () => {
        password.classList.remove("input-success");

        if (!password.value) {
            clearFieldError(password, passwordError);
        } else {
            const error = validatePassword(password.value);
            if (error) {
                showFieldError(password, passwordError, error);
            } else {
                clearFieldError(password, passwordError);
                password.classList.add("input-success");
            }
        }

        if (confirmPassword.value) checkPasswordMatch();
    });

    confirmPassword.addEventListener("input", checkPasswordMatch);

    form.addEventListener("submit", async event => {
        event.preventDefault();
        clearAllErrors();

        if (!password.value) {
            showFieldError(password, passwordError, "Password is required");
            password.focus();
            return;
        }

        const passwordErrorMessage = validatePassword(password.value);
        if (passwordErrorMessage) {
            showFieldError(password, passwordError, passwordErrorMessage);
            password.focus();
            return;
        }

        if (!confirmPassword.value) {
            showFieldError(confirmPassword, confirmPasswordError, "Please confirm your password");
            confirmPassword.focus();
            return;
        }

        if (password.value !== confirmPassword.value) {
            showFieldError(confirmPassword, confirmPasswordError, "Passwords do not match");
            confirmPassword.focus();
            return;
        }

        resetButton.classList.add("loading");
        resetButton.disabled = true;

        try {
            const response = await fetch(form.action, {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Accept": "application/json"
                },
                body: new URLSearchParams({
                    password: password.value,
                    confirm_password: confirmPassword.value
                })
            });

            const data = await response.json();

            if (!response.ok || !data.success) {
                resetButton.classList.remove("loading");
                resetButton.disabled = false;

                if (data.field === "password") {
                    showFieldError(password, passwordError, data.error || "Invalid password");
                    password.focus();
                    return;
                }

                if (data.field === "confirm_password") {
                    showFieldError(confirmPassword, confirmPasswordError, data.error || "Passwords do not match");
                    confirmPassword.focus();
                    return;
                }

                showFieldError(confirmPassword, confirmPasswordError, data.error || "Unable to reset your password");
                return;
            }

            resetButton.classList.remove("loading");
            resetButton.classList.add("success");
            resetButton.disabled = true;
            resetButton.querySelector(".reset-button-text").textContent = "Password updated";

            await new Promise(resolve => setTimeout(resolve, 850));
            window.location.href = data.redirect || "/login";
        } catch (error) {
            console.error("RESET PASSWORD ERROR:", error);
            resetButton.classList.remove("loading");
            resetButton.disabled = false;
            showFieldError(confirmPassword, confirmPasswordError, "Something went wrong. Please try again.");
        }
    });
});