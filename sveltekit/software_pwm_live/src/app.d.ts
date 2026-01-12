/// <reference types="@sveltejs/kit" />
/// <reference types="svelte" />
/// <reference types="vite/client" />

// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export { };

// Fix for "Cannot find name 'svelteHTML'" in Svelte 5
declare global {
	// eslint-disable-next-line no-var, @typescript-eslint/no-explicit-any
	var svelteHTML: any;
	namespace svelteHTML {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		type HTMLAttributes<T> = import('svelte/elements').HTMLAttributes<T>;
	}
}
