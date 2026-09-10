const fireIcon = document.getElementById("fireIcon");

if (fireIcon) {
    const outer = fireIcon.querySelector(".fire-outer");
    const inner = fireIcon.querySelector(".fire-inner");
    const core = fireIcon.querySelector(".fire-core");

    function flickerFire() {

        const outerScale = 0.97 + Math.random() * 0.06;
        const innerScale = 0.97 + Math.random() * 0.08;
        const coreScale = 0.94 + Math.random() * 0.1;

        const outerRotate = -2 + Math.random() * 4;
        const innerRotate = -2 + Math.random() * 4;

        outer.style.transform =
            `rotate(${outerRotate}deg) scaleX(${outerScale})`;

        inner.style.transform =
            `rotate(${innerRotate}deg) scale(${innerScale})`;

        core.style.transform =
            `translateX(${Math.random() * 1.2 - 0.6}px) scale(${coreScale})`;

        setTimeout(flickerFire, 180 + Math.random() * 180);
    }

    flickerFire();
}