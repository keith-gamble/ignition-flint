export function throttle<F extends (...args: any[]) => any>(func: F, delay: number): F {
	let timeoutId: ReturnType<typeof setTimeout> | null = null;
	let lastArgs: any[] | null = null;
  
	return function (this: any, ...args: any[]) {
	  const context = this;
  
	  if (timeoutId) {
		lastArgs = args;
		return;
	  }
  
	  func.apply(context, args);
  
	  timeoutId = setTimeout(() => {
		if (lastArgs) {
		  func.apply(context, lastArgs);
		  lastArgs = null;
		}
		timeoutId = null;
	  }, delay);
	} as F;
  }