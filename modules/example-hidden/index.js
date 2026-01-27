class ExampleHidden {
    constructor(config) {
        this.config = config;
    }

    getDom() {
        const wrapper = document.createElement('div');
        wrapper.className = 'example-hidden';
        wrapper.innerHTML = 'This is a hidden example module.';
        return wrapper;
    }
}

module.exports = ExampleHidden;
