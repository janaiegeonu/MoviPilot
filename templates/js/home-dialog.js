
// MOVIPILOT AUTH POPUP

const authModal = document.getElementById("authModal");
const authModalBox = document.getElementById("authModalBox");
const authModalClose = document.getElementById("authModalClose");


// OPEN POPUP

function openAuthModal() {
    authModal.classList.add("active");

    // Prevent background scrolling
    document.body.style.overflow = "hidden";
}


// CLOSE POPUP

function closeAuthModal() {
    authModal.classList.remove("active");

    // Allow background scrolling again
    document.body.style.overflow = "";
}


// SHOW POPUP AFTER 2 SECONDS
// BUT ONLY ONCE PER SESSION

if (!sessionStorage.getItem("movipilotAuthPromptShown")) {

    setTimeout(() => {

        openAuthModal();

        // Remember that the popup has already been shown
        sessionStorage.setItem(
            "movipilotAuthPromptShown",
            "true"
        );

    }, 8000);
}


// CLOSE BUTTON

authModalClose.addEventListener("click", () => {
    closeAuthModal();
});


// CLICK OUTSIDE POPUP TO CLOSE

authModal.addEventListener("click", (event) => {

    if (!authModalBox.contains(event.target)) {
        closeAuthModal();
    }

});


// ESCAPE KEY TO CLOSE

document.addEventListener("keydown", (event) => {

    if (event.key === "Escape") {
        closeAuthModal();
    }

});