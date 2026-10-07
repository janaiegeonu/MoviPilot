/* =========================================================
   MOVIPILOT EXPLORE PAGE
   ========================================================= */

(() => {
    "use strict";

    document.addEventListener("DOMContentLoaded", () => {
        const page = document.querySelector(".explore-page");
        if (!page) return;

        const mediaType = page.dataset.mediaType;
        const mediaID = Number(page.dataset.mediaId);
        const loggedIn = page.dataset.loggedIn === "true";

        const toast = document.getElementById("exploreToast");
        let toastTimer = null;

        function showToast(message) {
            if (!toast) return;
            toast.textContent = message;
            toast.classList.add("is-visible");
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => {
                toast.classList.remove("is-visible");
            }, 3200);
        }

        function requireLogin(message = "Please log in to use this MoviPilot feature.") {
            if (loggedIn) return true;
            showToast(message);
            return false;
        }

        async function requestJSON(url, options = {}) {
            const response = await fetch(url, {
                credentials: "same-origin",
                ...options,
                headers: {
                    Accept: "application/json",
                    ...(options.body ? { "Content-Type": "application/json" } : {}),
                    ...(options.headers || {})
                }
            });

            let payload = {};
            try {
                payload = await response.json();
            } catch (_) {
                payload = {};
            }

            if (!response.ok) {
                const error = new Error(payload.error || `Request failed (${response.status})`);
                error.status = response.status;
                throw error;
            }

            return payload;
        }

        function mediaPayload(extra = {}) {
            return {
                media_type: mediaType,
                media_id: mediaID,
                ...extra
            };
        }

        /* =====================================================
           BACK BUTTON
           ===================================================== */

        const backButton = document.getElementById("exploreBack");
        if (backButton) {
            backButton.addEventListener("click", () => {
                if (window.history.length > 1) {
                    window.history.back();
                    return;
                }
                window.location.href = "/dashboard";
            });
        }

        /* =====================================================
           WATCHLIST
           ===================================================== */

        const watchlistButton = document.getElementById("watchlistButton");
        const watchlistButtonLabel = document.getElementById("watchlistButtonLabel");

        if (watchlistButton) {
            watchlistButton.addEventListener("click", async () => {
                if (!requireLogin()) return;

                watchlistButton.disabled = true;
                try {
                    const result = await requestJSON("/api/explore/watchlist", {
                        method: "POST",
                        body: JSON.stringify(mediaPayload())
                    });

                    const active = result.watchlisted === true;
                    watchlistButton.classList.toggle("is-active", active);
                    if (watchlistButtonLabel) {
                        watchlistButtonLabel.textContent = active
                            ? "Remove from Watchlist"
                            : "Add to Watchlist";
                    }
                    showToast(active ? "Added to your Watchlist." : "Removed from your Watchlist.");
                } catch (error) {
                    if (error.status === 401) {
                        requireLogin();
                    } else {
                        showToast(error.message || "Could not update Watchlist.");
                    }
                } finally {
                    watchlistButton.disabled = false;
                }
            });
        }

        /* =====================================================
           TRAILER / VIDEO MODAL
           ===================================================== */

        const videoModal = document.getElementById("videoModal");
        const videoFrame = document.getElementById("videoFrame");
        const videoModalTitle = document.getElementById("videoModalTitle");
        const videoModalClose = document.getElementById("videoModalClose");
        const videoModalBackdrop = document.getElementById("videoModalBackdrop");

        function openVideo(key, title) {
            if (!videoModal || !videoFrame || !key) return;
            videoFrame.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(key)}?autoplay=1&rel=0&modestbranding=1`;
            if (videoModalTitle) {
                videoModalTitle.textContent = title || "MoviPilot video";
            }
            videoModal.hidden = false;
            document.body.style.overflow = "hidden";
            videoModalClose?.focus();
        }

        function closeVideo() {
            if (!videoModal || !videoFrame) return;
            videoFrame.src = "";
            videoModal.hidden = true;
            document.body.style.overflow = "";
        }

        document.getElementById("heroTrailerButton")?.addEventListener("click", (event) => {
            openVideo(event.currentTarget.dataset.videoKey, event.currentTarget.dataset.videoTitle);
        });

        document.querySelectorAll(".video-thumb-button").forEach((button) => {
            button.addEventListener("click", () => {
                openVideo(button.dataset.videoKey, button.dataset.videoTitle);
            });
        });

        videoModalClose?.addEventListener("click", closeVideo);
        videoModalBackdrop?.addEventListener("click", closeVideo);

        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape" && videoModal && !videoModal.hidden) {
                closeVideo();
            }
        });

        /* =====================================================
           RATING GATE
           ===================================================== */

        const ratingRoot = document.getElementById("starRating");
        const ratingStars = Array.from(document.querySelectorAll(".rating-star"));
        const ratingMessage = document.getElementById("userRatingMessage");
        let savedUserRating = ratingStars.filter((star) => star.classList.contains("is-filled")).length;
        const unlockRatingButton = document.getElementById("unlockRatingButton");

        function applyRating(rating) {
            ratingStars.forEach((star) => {
                star.classList.toggle("is-filled", Number(star.dataset.rating) <= rating);
            });
            savedUserRating = rating;
            if (ratingMessage) {
                ratingMessage.textContent = `You rated this ${rating}/5`;
            }
        }

        function setRatingUnlocked() {
            if (!ratingRoot) return;
            ratingRoot.dataset.enabled = "true";
            ratingRoot.setAttribute("aria-disabled", "false");
            ratingStars.forEach((star) => {
                star.disabled = false;
            });
            if (ratingMessage && savedUserRating === 0) {
                ratingMessage.textContent = "How would you rate it?";
            }
            unlockRatingButton?.remove();
        }

        ratingStars.forEach((star) => {
            star.addEventListener("mouseenter", () => {
                if (star.disabled) return;
                const rating = Number(star.dataset.rating);
                ratingStars.forEach((item) => {
                    item.classList.toggle("is-filled", Number(item.dataset.rating) <= rating);
                });
            });

            star.addEventListener("click", async () => {
                if (star.disabled) {
                    showToast(loggedIn
                        ? "Watch this title from a MoviPilot recommendation first to unlock ratings."
                        : "Please log in and watch this title from a recommendation to rate it.");
                    return;
                }

                if (!requireLogin()) return;
                const rating = Number(star.dataset.rating);
                star.classList.add("is-submitting");

                try {
                    await requestJSON("/api/explore/rating", {
                        method: "POST",
                        body: JSON.stringify(mediaPayload({ rating }))
                    });
                    applyRating(rating);
                    showToast("Your MoviPilot rating was saved.");
                } catch (error) {
                    showToast(error.message || "Could not save rating.");
                } finally {
                    star.classList.remove("is-submitting");
                }
            });
        });

        ratingRoot?.addEventListener("mouseleave", () => {
            ratingStars.forEach((star) => {
                star.classList.toggle("is-filled", Number(star.dataset.rating) <= savedUserRating);
            });
        });

        unlockRatingButton?.addEventListener("click", async () => {
            if (!requireLogin()) return;
            unlockRatingButton.disabled = true;
            try {
                await requestJSON("/api/explore/watch-event", {
                    method: "POST",
                    body: JSON.stringify(mediaPayload({ source: "recommendation" }))
                });
                setRatingUnlocked();
                showToast("Watched status recorded. Your 5-star rating is unlocked.");
            } catch (error) {
                showToast(error.message || "Could not record watched status.");
                unlockRatingButton.disabled = false;
            }
        });

        /* =====================================================
           COLLECTION PICKER
           ===================================================== */

        const collectionPanel = document.getElementById("collectionPanel");
        const collectionButton = document.getElementById("collectionButton");
        const collectionPanelClose = document.getElementById("collectionPanelClose");
        const createCollectionForm = document.getElementById("createCollectionForm");
        const newCollectionName = document.getElementById("newCollectionName");
        const collectionList = document.getElementById("collectionList");

        function collectionChoiceHTML(collection) {
            const count = Number(collection.item_count || collection.ItemCount || 0);
            return `
                <button class="collection-choice" type="button" data-collection-id="${Number(collection.id || collection.ID)}">
                    <span class="collection-choice-icon">
                        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <path d="M5 7.5C5 6.67 5.67 6 6.5 6H10L12 8H17.5C18.33 8 19 8.67 19 9.5V17.5C19 18.33 18.33 19 17.5 19H6.5C5.67 19 5 18.33 5 17.5V7.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
                        </svg>
                    </span>
                    <span>
                        <strong>${escapeHTML(collection.name || collection.Name || "Collection")}</strong>
                        <small>${count} items</small>
                    </span>
                </button>`;
        }

        function escapeHTML(value) {
            return String(value)
                .replaceAll("&", "&amp;")
                .replaceAll("<", "&lt;")
                .replaceAll(">", "&gt;")
                .replaceAll('"', "&quot;")
                .replaceAll("'", "&#039;");
        }

        async function loadCollections() {
            if (!loggedIn || !collectionList) return;
            try {
                const result = await requestJSON("/api/explore/collections");
                const collections = Array.isArray(result.collections) ? result.collections : [];
                if (!collections.length) {
                    collectionList.innerHTML = '<div class="collection-empty">No collections yet. Create your first one beside it.</div>';
                    return;
                }
                collectionList.innerHTML = collections.map(collectionChoiceHTML).join("");
                bindCollectionChoices();
            } catch (error) {
                showToast(error.message || "Could not load collections.");
            }
        }

        function openCollectionPanel() {
            if (!requireLogin()) return;
            if (!collectionPanel) return;
            collectionPanel.hidden = false;
            collectionPanel.scrollIntoView({ behavior: "smooth", block: "center" });
            loadCollections();
        }

        function closeCollectionPanel() {
            if (!collectionPanel) return;
            collectionPanel.hidden = true;
        }

        async function addToCollection(collectionID) {
            try {
                await requestJSON("/api/explore/collection-items", {
                    method: "POST",
                    body: JSON.stringify({
                        collection_id: Number(collectionID),
                        media_type: mediaType,
                        media_id: mediaID
                    })
                });
                showToast("Added to your collection.");
            } catch (error) {
                showToast(error.message || "Could not add title to collection.");
            }
        }

        function bindCollectionChoices() {
            document.querySelectorAll(".collection-choice").forEach((choice) => {
                choice.addEventListener("click", async () => {
                    await addToCollection(choice.dataset.collectionId);
                    closeCollectionPanel();
                });
            });
        }

        collectionButton?.addEventListener("click", openCollectionPanel);
        collectionPanelClose?.addEventListener("click", closeCollectionPanel);

        createCollectionForm?.addEventListener("submit", async (event) => {
            event.preventDefault();
            if (!requireLogin()) return;

            const name = newCollectionName?.value.trim() || "";
            if (!name) {
                showToast("Enter a collection name first.");
                newCollectionName?.focus();
                return;
            }

            const submitButton = createCollectionForm.querySelector("button[type='submit']");
            if (submitButton) submitButton.disabled = true;

            try {
                const result = await requestJSON("/api/explore/collections", {
                    method: "POST",
                    body: JSON.stringify({ name })
                });
                const collection = result.collection;
                if (!collection || !collection.id) {
                    throw new Error("Collection was not created.");
                }

                await addToCollection(collection.id);
                newCollectionName.value = "";
                await loadCollections();
                showToast(`“${name}” created and title added.`);
            } catch (error) {
                showToast(error.message || "Could not create collection.");
            } finally {
                if (submitButton) submitButton.disabled = false;
            }
        });

        bindCollectionChoices();

        /* =====================================================
           LIKE
           ===================================================== */

        const likeButton = document.getElementById("likeButton");
        const likeButtonLabel = document.getElementById("likeButtonLabel");
        const communityLikeCount = document.getElementById("communityLikeCount");

        likeButton?.addEventListener("click", async () => {
            if (!requireLogin()) return;
            likeButton.disabled = true;
            try {
                const result = await requestJSON("/api/explore/like", {
                    method: "POST",
                    body: JSON.stringify(mediaPayload())
                });
                const liked = result.liked === true;
                likeButton.classList.toggle("is-liked", liked);
                if (likeButtonLabel) likeButtonLabel.textContent = liked ? "Liked" : "Like this title";
                if (communityLikeCount && Number.isFinite(Number(result.like_count))) {
                    communityLikeCount.textContent = result.like_count;
                }
                showToast(liked ? "You liked this title." : "Like removed.");
            } catch (error) {
                showToast(error.message || "Could not update like.");
            } finally {
                likeButton.disabled = false;
            }
        });

        /* =====================================================
           REVIEWS
           ===================================================== */

        const reviewInput = document.getElementById("reviewInput");
        const reviewSubmit = document.getElementById("reviewSubmit");
        const reviewStatus = document.getElementById("reviewStatus");
        const reviewsFeed = document.getElementById("reviewsFeed");

        function renderReviews(reviews) {
            if (!reviewsFeed) return;
            if (!Array.isArray(reviews) || !reviews.length) {
                reviewsFeed.innerHTML = `
                    <div class="review-empty">
                        <svg viewBox="0 0 64 64" fill="none" aria-hidden="true">
                            <path d="M14 18C14 14.69 16.69 12 20 12H44C47.31 12 50 14.69 50 18V35C50 38.31 47.31 41 44 41H31L22 50V41H20C16.69 41 14 38.31 14 35V18Z" stroke="currentColor" stroke-width="1.6"/>
                            <path d="M23 25H41M23 31H36" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                        </svg>
                        <strong>No reviews yet</strong>
                        <span>Be the first MoviPilot viewer to leave a public review.</span>
                    </div>`;
                return;
            }

            reviewsFeed.innerHTML = reviews.map((review) => `
                <article class="review-item">
                    <div class="review-avatar">${escapeHTML((review.author_name || review.AuthorName || "M").slice(0, 1))}</div>
                    <div class="review-body">
                        <div class="review-meta">
                            <strong>${escapeHTML(review.author_name || review.AuthorName || "MoviPilot User")}</strong>
                            <time>${escapeHTML(review.created_at || review.CreatedAt || "")}</time>
                        </div>
                        <p>${escapeHTML(review.review || review.Review || "")}</p>
                    </div>
                </article>`).join("");
        }

        async function refreshCommunity() {
            try {
                const result = await requestJSON(`/api/explore/state?type=${encodeURIComponent(mediaType)}&id=${encodeURIComponent(mediaID)}`);
                const community = result.community || {};
                const user = result.user || {};

                if (communityLikeCount) communityLikeCount.textContent = community.like_count ?? community.LikeCount ?? 0;
                const communityRatingAverage = document.getElementById("communityRatingAverage");
                const ratingCount = Number(community.rating_count ?? community.RatingCount ?? 0);
                const average = Number(community.community_rating ?? community.CommunityRating ?? 0);
                if (communityRatingAverage) {
                    communityRatingAverage.textContent = ratingCount ? average.toFixed(1) : "—";
                }

                const liked = community.current_user_liked ?? community.CurrentUserLiked ?? false;
                likeButton?.classList.toggle("is-liked", liked);
                if (likeButtonLabel) likeButtonLabel.textContent = liked ? "Liked" : "Like this title";

                if (user.rating) applyRating(Number(user.rating));
                if (user.can_rate ?? user.CanRate) setRatingUnlocked();
                renderReviews(community.reviews || community.Reviews || []);
            } catch (_) {
                /* Page already contains a valid server-rendered state. */
            }
        }

        reviewSubmit?.addEventListener("click", async () => {
            if (!requireLogin()) return;
            const review = reviewInput?.value.trim() || "";
            if (!review) {
                showToast("Write a review before posting.");
                reviewInput?.focus();
                return;
            }

            reviewSubmit.disabled = true;
            try {
                await requestJSON("/api/explore/review", {
                    method: "POST",
                    body: JSON.stringify(mediaPayload({ review }))
                });
                if (reviewInput) reviewInput.value = "";
                if (reviewStatus) reviewStatus.textContent = "Review published to the MoviPilot community";
                showToast("Your review is now public on MoviPilot.");
                await refreshCommunity();
            } catch (error) {
                showToast(error.message || "Could not publish review.");
            } finally {
                reviewSubmit.disabled = false;
            }
        });

        /* =====================================================
           VIDEO FILTERS
           ===================================================== */

        const normalizedType = (value) => String(value || "").trim().toLowerCase();
        document.querySelectorAll(".video-filter").forEach((filterButton) => {
            filterButton.addEventListener("click", () => {
                document.querySelectorAll(".video-filter").forEach((button) => button.classList.remove("is-active"));
                filterButton.classList.add("is-active");

                const selected = normalizedType(filterButton.dataset.videoFilter);
                document.querySelectorAll(".video-card").forEach((card) => {
                    const type = normalizedType(card.dataset.videoType || "other");
                    const visible = selected === "all" || type === selected;
                    card.classList.toggle("is-filtered-out", !visible);
                });
            });
        });

        /* =====================================================
           RAIL CONTROLS
           ===================================================== */

        document.querySelectorAll("[data-scroll-target]").forEach((button) => {
            button.addEventListener("click", () => {
                const target = document.getElementById(button.dataset.scrollTarget);
                if (!target) return;
                const direction = Number(button.dataset.scrollDirection || 1);
                target.scrollBy({
                    left: direction * Math.max(target.clientWidth * 0.78, 360),
                    behavior: "smooth"
                });
            });
        });

        /* =====================================================
           KEYWORD FETCHING
           ===================================================== */

        const keywordResultsPanel = document.getElementById("keywordResultsPanel");
        const keywordResultsGrid = document.getElementById("keywordResultsGrid");
        const keywordResultsTitle = document.getElementById("keywordResultsTitle");
        const keywordResultsClose = document.getElementById("keywordResultsClose");

        function recommendationCardHTML(movie) {
            const type = movie.media_type || movie.MediaType || "movie";
            const id = Number(movie.id || movie.ID || 0);
            const title = movie.title || movie.Title || "Untitled";
            const poster = movie.poster_url || movie.PosterURL || "";
            const year = movie.year || movie.Year || "";
            const genre = movie.genre || movie.Genre || "";
            const rating = Number(movie.rating ?? movie.Rating ?? 0);
            return `
                <a class="recommend-card keyword-result-card" href="/explore?type=${encodeURIComponent(type)}&id=${id}">
                    <div class="recommend-poster-wrap">
                        ${poster ? `<img src="${escapeHTML(poster)}" alt="${escapeHTML(title)} poster" loading="lazy">` : ""}
                        <span class="recommend-poster-glow"></span>
                        ${rating > 0 ? `<span class="recommend-rating">★ ${rating.toFixed(1)}</span>` : ""}
                    </div>
                    <div class="recommend-card-content">
                        <h3>${escapeHTML(title)}</h3>
                        <div><span>${escapeHTML(year)}</span><i></i><span>${escapeHTML(genre)}</span></div>
                    </div>
                </a>`;
        }

        document.querySelectorAll(".keyword-chip").forEach((chip) => {
            chip.addEventListener("click", async () => {
                const keywordID = Number(chip.dataset.keywordId);
                const keywordName = chip.dataset.keywordName || "Keyword";
                if (!keywordID || !keywordResultsPanel || !keywordResultsGrid) return;

                keywordResultsPanel.hidden = false;
                keywordResultsGrid.innerHTML = '<div class="empty-inline">Fetching keyword matches…</div>';
                if (keywordResultsTitle) keywordResultsTitle.textContent = `Movies with “${keywordName}”`;
                keywordResultsPanel.scrollIntoView({ behavior: "smooth", block: "center" });

                try {
                    const result = await requestJSON(`/api/explore/keyword-movies?keyword_id=${encodeURIComponent(keywordID)}`);
                    const items = Array.isArray(result.results) ? result.results : [];
                    if (!items.length) {
                        keywordResultsGrid.innerHTML = '<div class="empty-inline">No matching movies were found for this keyword.</div>';
                        return;
                    }
                    keywordResultsGrid.innerHTML = items.map(recommendationCardHTML).join("");
                } catch (error) {
                    keywordResultsGrid.innerHTML = `<div class="empty-inline">${escapeHTML(error.message || "Could not fetch keyword matches.")}</div>`;
                }
            });
        });

        keywordResultsClose?.addEventListener("click", () => {
            if (keywordResultsPanel) keywordResultsPanel.hidden = true;
        });

        /* =====================================================
           SCROLL REVEALS
           ===================================================== */

        const revealImmediately = () => {
            document.querySelectorAll(".reveal-on-load").forEach((element) => {
                requestAnimationFrame(() => element.classList.add("is-revealed"));
            });
        };

        revealImmediately();

        if ("IntersectionObserver" in window) {
            const observer = new IntersectionObserver((entries) => {
                entries.forEach((entry) => {
                    if (!entry.isIntersecting) return;
                    entry.target.classList.add("is-revealed");
                    observer.unobserve(entry.target);
                });
            }, { threshold: 0.09 });

            document.querySelectorAll(".reveal-on-scroll").forEach((element) => observer.observe(element));
        } else {
            document.querySelectorAll(".reveal-on-scroll").forEach((element) => element.classList.add("is-revealed"));
        }

        /* =====================================================
           AUTH UX
           ===================================================== */

        document.querySelectorAll("[data-auth-required='true']").forEach((button) => {
            if (!loggedIn) {
                button.setAttribute("aria-describedby", "exploreAuthNote");
            }
        });

        if (!loggedIn) {
            const authNote = document.createElement("span");
            authNote.id = "exploreAuthNote";
            authNote.textContent = "Log in to save, like, rate, review, and create collections.";
            authNote.style.display = "none";
            document.body.appendChild(authNote);
        }

        /* =====================================================
           INITIAL COMMUNITY REFRESH
           ===================================================== */

        if (loggedIn) {
            refreshCommunity();
        }
    });
})();
