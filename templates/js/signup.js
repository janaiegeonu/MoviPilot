// =========================================
// MOVIPILOT SIGNUP PAGE
// =========================================

document.addEventListener("DOMContentLoaded", () => {

    // =========================================
    // SIGNUP FORM ELEMENTS
    // =========================================

    const signupForm = document.getElementById("signupForm");

    // Use one storage key for the entire signup form.
    const storageKey = "movipilotSignupDraft";

    // These names match your actual signup HTML.
    const fieldNames = [
        "fullname",
        "email",
        "password",
        "confirmPassword"
    ];


    // =========================================
    // GET A FORM FIELD BY ITS NAME
    // =========================================

    function getFormField(name) {

        if (!signupForm) {
            return null;
        }

        return signupForm.elements.namedItem(name);
    }


    // =========================================
    // SAVE THE COMPLETE SIGNUP FORM
    // =========================================

    function saveSignupDraft() {

        if (!signupForm) {
            return;
        }

        // This object will contain the values entered
        // into the signup form.
        const draft = {};

        // Save each text, email, and password field.
        fieldNames.forEach((name) => {

            const field = getFormField(name);

            if (field && typeof field.value === "string") {

                draft[name] = field.value;

            }

        });


        // Save whether the user accepted the terms.
        const termsCheckbox = getFormField("terms");

        if (termsCheckbox) {

            draft.termsAccepted = termsCheckbox.checked;

        }


        // Store the form in sessionStorage.
        // This survives page navigation and reloads
        // within the same browser tab.
        try {

            sessionStorage.setItem(
                storageKey,
                JSON.stringify(draft)
            );

            // Remove the two legacy password entries
            // used by the previous version of signup.js.
            sessionStorage.removeItem("movipilotPassword");

            sessionStorage.removeItem(
                "movipilotConfirmPassword"
            );

        } catch (error) {

            console.error(
                "MoviPilot could not save the signup draft:",
                error
            );

        }

    }


    // =========================================
    // RESTORE THE COMPLETE SIGNUP FORM
    // =========================================

    function restoreSignupDraft() {

        if (!signupForm) {
            return;
        }

        let draft = null;

        let legacyDraftFound = false;

        try {

            const savedDraft =
                sessionStorage.getItem(storageKey);


            // First, look for the complete saved form.
            if (savedDraft !== null) {

                try {

                    draft = JSON.parse(savedDraft);

                } catch (error) {

                    console.error(
                        "MoviPilot could not read the saved signup draft:",
                        error
                    );

                }

            }


            // =====================================
            // SUPPORT PASSWORDS SAVED BY OLD CODE
            // =====================================

            // If the new complete draft doesn't exist,
            // check whether the previous script saved
            // either password field separately.

            if (!draft || typeof draft !== "object") {

                draft = {};

            }

            if (
                !Object.prototype.hasOwnProperty.call(
                    draft,
                    "password"
                )
            ) {

                const oldPassword =
                    sessionStorage.getItem(
                        "movipilotPassword"
                    );

                if (oldPassword !== null) {

                    draft.password = oldPassword;

                    legacyDraftFound = true;

                }

            }


            if (
                !Object.prototype.hasOwnProperty.call(
                    draft,
                    "confirmPassword"
                )
            ) {

                const oldConfirmPassword =
                    sessionStorage.getItem(
                        "movipilotConfirmPassword"
                    );

                if (oldConfirmPassword !== null) {

                    draft.confirmPassword =
                        oldConfirmPassword;

                    legacyDraftFound = true;

                }

            }


            // =====================================
            // RESTORE THE TEXT AND PASSWORD FIELDS
            // =====================================

            fieldNames.forEach((name) => {

                const field = getFormField(name);

                if (
                    field &&
                    Object.prototype.hasOwnProperty.call(
                        draft,
                        name
                    ) &&
                    typeof draft[name] === "string"
                ) {

                    field.value = draft[name];

                }

            });


            // =====================================
            // RESTORE THE TERMS CHECKBOX
            // =====================================

            const termsCheckbox =
                getFormField("terms");

            if (
                termsCheckbox &&
                typeof draft.termsAccepted === "boolean"
            ) {

                termsCheckbox.checked =
                    draft.termsAccepted;

            }


            // Migrate old password values into the
            // new complete-draft format.
            if (legacyDraftFound) {

                saveSignupDraft();

            }


            console.log(
                "[MOVIPILOT SIGNUP] Form restoration completed."
            );

        } catch (error) {

            console.error(
                "MoviPilot could not restore the signup form:",
                error
            );

        }

    }


    // =========================================
    // RESTORE SAVED VALUES WHEN THE PAGE OPENS
    // =========================================

    // IMPORTANT:
    // Call this directly because DOMContentLoaded
    // has already fired at this point.
    restoreSignupDraft();


    // =========================================
    // AUTOMATICALLY SAVE WHILE THE USER TYPES
    // =========================================

    if (signupForm) {

        // Save immediately when a field changes.
        signupForm.addEventListener(
            "input",
            saveSignupDraft
        );

        signupForm.addEventListener(
            "change",
            saveSignupDraft
        );


        // Save once more before the signup form submits.
        // This also helps preserve the values if the
        // server returns a validation error.
        signupForm.addEventListener(
            "submit",
            saveSignupDraft
        );

    }


    // =========================================
    // SAVE BEFORE OPENING LEGAL PAGES
    // =========================================

    // Use event delegation so this works for both
    // legal links in your signup form.
    document.addEventListener("click", (event) => {

        const link = event.target.closest("a[href]");

        if (!link) {
            return;
        }

        try {

            const destination = new URL(
                link.href,
                window.location.origin
            );

            // Only handle links to the legal pages
            // on the current website.
            if (
                destination.origin === window.location.origin &&
                (
                    destination.pathname === "/terms" ||
                    destination.pathname === "/privacy-policy"
                )
            ) {

                saveSignupDraft();

            }

        } catch (error) {

            console.error(
                "Could not check the legal page link:",
                error
            );

        }

    });


    // =========================================
    // SAVE WHEN LEAVING OR RELOADING THE PAGE
    // =========================================

    // This provides an additional safety net.
    // The input/change listeners already save regularly,
    // but pagehide saves the latest state before departure.
    window.addEventListener(
        "pagehide",
        saveSignupDraft
    );


    // =========================================
    // PASSWORD VISIBILITY TOGGLE
    // =========================================

    document.querySelectorAll(".password-toggle").forEach(
        (button) => {

            button.addEventListener("click", function () {

                const targetId =
                    this.getAttribute("data-target");

                const passwordInput =
                    document.getElementById(targetId);

                if (!passwordInput) {
                    return;
                }

                // Switch between password and visible text.
                const isPassword =
                    passwordInput.type === "password";

                passwordInput.type =
                    isPassword ? "text" : "password";


                // Update the button's visual state.
                this.classList.toggle(
                    "is-visible",
                    isPassword
                );


                // Update the accessibility label.
                this.setAttribute(
                    "aria-label",
                    isPassword
                        ? "Hide password"
                        : "Show password"
                );

            });

        }
    );


    // =========================================
    // GOOGLE SIGNUP
    // =========================================

    const googleSignup =
        document.getElementById("googleSignup");

    if (googleSignup) {

        googleSignup.addEventListener(
            "click",
            () => {

                console.log(
                    "Google signup selected"
                );

            }
        );

    }


});