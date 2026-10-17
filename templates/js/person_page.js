(() => {
    "use strict";

    if (document.body) {
        document.body.classList.add("person-js-ready");
    }

    document.addEventListener("DOMContentLoaded", () => {
        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const toast = document.getElementById("personToast");
        let toastTimer = 0;

        // Back navigation keeps the previous Explore screen when possible.
        const backButton = document.getElementById("personBack");
        backButton?.addEventListener("click", () => {
            if (window.history.length > 1) {
                window.history.back();
                return;
            }

            window.location.assign("/dashboard");
        });

        const showToast = (message) => {
            if (!toast) return;

            toast.textContent = message;
            toast.classList.add("is-visible");
            window.clearTimeout(toastTimer);
            toastTimer = window.setTimeout(() => {
                toast.classList.remove("is-visible");
            }, 2600);
        };

        // Copying the profile URL is useful when sharing a cast member with friends.
        const shareButton = document.getElementById("personShareButton");
        shareButton?.addEventListener("click", async () => {
            const profileURL = window.location.href;

            try {
                if (navigator.clipboard && window.isSecureContext) {
                    await navigator.clipboard.writeText(profileURL);
                } else {
                    const temporaryInput = document.createElement("textarea");
                    temporaryInput.value = profileURL;
                    temporaryInput.setAttribute("readonly", "");
                    temporaryInput.style.position = "fixed";
                    temporaryInput.style.opacity = "0";
                    temporaryInput.style.pointerEvents = "none";
                    document.body.appendChild(temporaryInput);
                    temporaryInput.select();
                    const copied = document.execCommand("copy");
                    temporaryInput.remove();

                    if (!copied) throw new Error("Copy command was unavailable");
                }

                showToast("Profile link copied to clipboard");
            } catch (error) {
                showToast("Copy was blocked by this browser. You can copy the page URL from the address bar.");
            }
        });

        // Only add the biography expander when it is actually needed.
        const bioText = document.getElementById("personBioText");
        const bioToggle = document.getElementById("personBioToggle");

        if (bioText && bioToggle) {
            if (bioText.textContent.trim().length < 720) {
                bioToggle.hidden = true;
            } else {
                bioText.classList.add("is-collapsed");
                bioToggle.classList.add("is-enabled");
                bioToggle.addEventListener("click", () => {
                    const expanded = bioToggle.getAttribute("aria-expanded") === "true";
                    bioToggle.setAttribute("aria-expanded", String(!expanded));
                    bioText.classList.toggle("is-collapsed", expanded);

                    const label = bioToggle.querySelector("span");
                    if (label) {
                        label.textContent = expanded ? "Read full biography" : "Show less";
                    }
                });
            }
        }

        // Reveal sections as they enter the viewport. The fallback makes sure the
        // page remains readable in browsers without IntersectionObserver.
        const revealItems = document.querySelectorAll(".reveal-person");

        if (reducedMotion || !("IntersectionObserver" in window)) {
            revealItems.forEach((item) => item.classList.add("is-visible"));
        } else {
            const revealObserver = new IntersectionObserver((entries, observer) => {
                entries.forEach((entry) => {
                    if (!entry.isIntersecting) return;
                    entry.target.classList.add("is-visible");
                    observer.unobserve(entry.target);
                });
            }, {
                threshold: 0.08,
                rootMargin: "0px 0px -28px 0px"
            });

            revealItems.forEach((item) => revealObserver.observe(item));
        }

        // Gentle count-up motion for numeric career statistics.
        const countItems = document.querySelectorAll("[data-count-value]");
        countItems.forEach((item) => {
            const finalValue = Number.parseInt(item.textContent.trim(), 10);
            if (!Number.isFinite(finalValue) || finalValue <= 0 || reducedMotion) return;

            item.textContent = "0";
            const duration = 620;
            const startTime = performance.now();

            const step = (now) => {
                const progress = Math.min((now - startTime) / duration, 1);
                const eased = 1 - Math.pow(1 - progress, 3);
                item.textContent = String(Math.round(finalValue * eased));
                if (progress < 1) window.requestAnimationFrame(step);
            };

            window.requestAnimationFrame(step);
        });

        // Filter, search and sort the filmography without reloading the page.
        const grid = document.getElementById("personFilmographyGrid");
        const cards = grid ? Array.from(grid.querySelectorAll("[data-credit-card]")) : [];
        const filterButtons = Array.from(document.querySelectorAll("[data-credit-filter]"));
        const searchInput = document.getElementById("personCreditSearch");
        const sortSelect = document.getElementById("personCreditSort");
        const visibleCount = document.getElementById("personVisibleCreditCount");
        const noMatches = document.getElementById("personNoCreditsMatch");
        const clearButton = document.getElementById("personClearFilters");
        let activeFilter = "all";

        const cardYear = (card) => {
            const match = String(card.dataset.year || "").match(/\d{4}/);
            return match ? Number.parseInt(match[0], 10) : 0;
        };

        const cardRating = (card) => {
            const value = Number.parseFloat(card.dataset.rating || "0");
            return Number.isFinite(value) ? value : 0;
        };

        const sortCards = () => {
            if (!grid || !sortSelect) return;

            const mode = sortSelect.value;
            const sorted = [...cards].sort((a, b) => {
                if (mode === "rating") return cardRating(b) - cardRating(a) || cardYear(b) - cardYear(a);
                if (mode === "title") return String(a.dataset.title || "").localeCompare(String(b.dataset.title || ""));
                return cardYear(b) - cardYear(a);
            });

            sorted.forEach((card) => grid.appendChild(card));
        };

        const applyCreditsView = () => {
            const query = String(searchInput?.value || "").trim().toLocaleLowerCase();
            let count = 0;

            cards.forEach((card) => {
                const matchesType = activeFilter === "all" || card.dataset.mediaType === activeFilter;
                const searchableText = `${card.dataset.title || ""} ${card.dataset.character || ""} ${card.dataset.year || ""}`.toLocaleLowerCase();
                const matchesSearch = query === "" || searchableText.includes(query);
                const visible = matchesType && matchesSearch;

                card.hidden = !visible;
                if (visible) count += 1;
            });

            if (visibleCount) visibleCount.textContent = String(count);
            if (noMatches) noMatches.hidden = count > 0 || cards.length === 0;
        };

        filterButtons.forEach((button) => {
            button.addEventListener("click", () => {
                activeFilter = button.dataset.creditFilter || "all";

                filterButtons.forEach((candidate) => {
                    const active = candidate === button;
                    candidate.classList.toggle("is-active", active);
                    candidate.setAttribute("aria-pressed", String(active));
                });

                applyCreditsView();
            });
        });

        searchInput?.addEventListener("input", applyCreditsView);
        sortSelect?.addEventListener("change", () => {
            sortCards();
            applyCreditsView();
        });

        clearButton?.addEventListener("click", () => {
            if (searchInput) searchInput.value = "";
            activeFilter = "all";

            filterButtons.forEach((button) => {
                const active = button.dataset.creditFilter === "all";
                button.classList.toggle("is-active", active);
                button.setAttribute("aria-pressed", String(active));
            });

            if (sortSelect) sortSelect.value = "recent";
            sortCards();
            applyCreditsView();
            searchInput?.focus();
        });

        // Keyboard shortcut: press / to focus the filmography search box.
        document.addEventListener("keydown", (event) => {
            const target = event.target;
            const isTyping = target instanceof HTMLElement && (
                target.isContentEditable ||
                ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
            );

            if (event.key === "/" && !isTyping && !event.ctrlKey && !event.metaKey && !event.altKey && searchInput) {
                event.preventDefault();
                searchInput.focus();
            }

            if (event.key === "Escape" && target === searchInput && searchInput.value) {
                searchInput.value = "";
                applyCreditsView();
            }
        });

        sortCards();
        applyCreditsView();

        // Avoid broken-image icons if TMDB no longer serves an asset.
        document.querySelectorAll(".person-gallery-image-wrap img").forEach((image) => {
            image.addEventListener("error", () => {
                const figure = image.closest(".person-gallery-card");
                const galleryGrid = figure?.closest(".person-gallery-grid");
                if (figure) figure.remove();
                if (galleryGrid && galleryGrid.querySelectorAll(".person-gallery-card").length === 0) {
                    const gallerySection = galleryGrid.closest(".person-gallery-section");
                    if (gallerySection) gallerySection.hidden = true;
                }
            }, { once: true });
        });

        document.querySelectorAll(".person-credit-poster > img").forEach((image) => {
            image.addEventListener("error", () => {
                const poster = image.closest(".person-credit-poster");
                image.remove();
                poster?.classList.add("image-unavailable");
            }, { once: true });
        });

        const heroBackdrop = document.querySelector(".person-hero-backdrop");
        heroBackdrop?.addEventListener("error", () => heroBackdrop.remove(), { once: true });

        const portrait = document.querySelector(".person-photo");
        portrait?.addEventListener("error", () => {
            portrait.remove();
            const photoWrap = document.querySelector(".person-photo-wrap");
            if (!photoWrap) return;

            const fallback = document.createElement("div");
            fallback.className = "person-photo-fallback";
            fallback.innerHTML = "<svg viewBox='0 0 64 64' fill='none' aria-hidden='true'><circle cx='32' cy='21' r='11' stroke='currentColor' stroke-width='1.5'/><path d='M12 54c1.5-11.2 8.3-17 20-17s18.5 5.8 20 17' stroke='currentColor' stroke-width='1.5' stroke-linecap='round'/></svg><span>Portrait unavailable</span>";
            photoWrap.prepend(fallback);
        }, { once: true });
    });
})();