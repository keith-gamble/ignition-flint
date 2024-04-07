export function debounce<F extends (...args: any[]) => any>(func: F, delay: number): F {
	let timeoutId: ReturnType<typeof setTimeout> | null = null;
  
	return function (this: any, ...args: any[]) {
	  const context = this;
  
	  if (timeoutId) {
		clearTimeout(timeoutId);
	  }
  
	  timeoutId = setTimeout(() => {
		func.apply(context, args);
	  }, delay);
	} as F;
  }