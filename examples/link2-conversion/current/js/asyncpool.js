/**
 * Async pool utility for limiting concurrent async operations
 * ES7 version of async-pool library for managing concurrent promise execution
 * Original source: https://github.com/rxaviers/async-pool/
 * MIT license
 * Copyright (c) 2017 Rafael Xavier de Souza
 */

export async function asyncPool(poolLimit, iterable, iteratorFn) {
	const ret = []
	const executing = new Set()
	for (const item of iterable) {
		const p = Promise.resolve().then(() => iteratorFn(item, iterable))
		ret.push(p)
		executing.add(p)
		const clean = () => executing.delete(p)
		p.then(clean).catch(clean)
		if (executing.size >= poolLimit) {
			await Promise.race(executing)
		}
	}
	return Promise.all(ret)
}