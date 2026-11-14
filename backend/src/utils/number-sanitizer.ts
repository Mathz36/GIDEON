/**
 * Converte de forma resiliente valores numéricos, strings PT-BR, BigInt e instâncias de Decimal.js
 * para number primitivo do JavaScript.
 */
export function parseNumericValue(val: unknown): number | null {
	if (typeof val === 'number') {
		return Number.isFinite(val) ? val : null;
	}
	if (typeof val === 'bigint') {
		const num = Number(val);
		return Number.isSafeInteger(num) ? num : null;
	}
	if (val && typeof val === 'object') {
		if (typeof (val as { toNumber?: unknown }).toNumber === 'function') {
			const n = (val as { toNumber: () => number }).toNumber();
			return typeof n === 'number' && Number.isFinite(n) ? n : null;
		}
		if ('d' in val && 's' in val) {
			const decObj = val as { d?: unknown; s?: unknown; e?: unknown };
			const dArr = Array.isArray(decObj.d) ? decObj.d : [];
			const sign = typeof decObj.s === 'number' ? decObj.s : 1;
			const exp = typeof decObj.e === 'number' ? decObj.e : null;
			const digits = dArr.map(String).join('');
			if (digits) {
				if (exp !== null) {
					const first = digits[0];
					const rest = digits.slice(1);
					const mantissa = rest ? Number(`${first}.${rest}`) : Number(first);
					const n = sign * mantissa * Math.pow(10, exp);
					if (Number.isFinite(n)) return n;
				}
				const n = Number(digits) * sign;
				if (Number.isFinite(n)) return n;
			}
		}
	}
	if (typeof val === 'string') {
		const trimmed = val.trim();
		if (!trimmed) return null;
		if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
			const parsed = Number(trimmed);
			return Number.isFinite(parsed) ? parsed : null;
		}
		if (/^(R\$\s*)?-?\d{1,3}(\.\d{3})*(,\d+)?$/.test(trimmed)) {
			const normalized = trimmed.replace(/R\$\s*/g, '').replace(/\./g, '').replace(',', '.');
			const parsed = Number(normalized);
			return Number.isFinite(parsed) ? parsed : null;
		}
	}
	return null;
}
