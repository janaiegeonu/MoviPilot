(() => {
    "use strict";
    document.addEventListener("DOMContentLoaded", () => {
        const back = document.getElementById("personBack");
        back?.addEventListener("click", () => {
            if (window.history.length > 1) {
                window.history.back();
                return;
            }
            window.location.href = "/dashboard";
        });

        const items = document.querySelectorAll(".reveal-person");
        if (!("IntersectionObserver" in window)) {
            items.forEach((item) => item.classList.add("is-visible"));
            return;
        }
        const observer = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                entry.target.classList.add("is-visible");
                observer.unobserve(entry.target);
            });
        }, { threshold: 0.08 });
        items.forEach((item) => observer.observe(item));
    });
})();
