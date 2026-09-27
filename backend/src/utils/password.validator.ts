/**
 * Padrão Regex para política de senhas:
 * - Mínimo de 8 caracteres
 * - Pelo menos 1 letra minúscula
 * - Pelo menos 1 letra maiúscula
 * - Pelo menos 1 número
 * - Pelo menos 1 caractere especial (qualquer caractere não alfanumérico ou underline)
 */
export const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/;

export interface PasswordValidationResult {
	isValid: boolean;
	message?: string;
}

export function validatePassword(password: string): PasswordValidationResult {
	if (!password || typeof password !== 'string') {
		return {
			isValid: false,
			message: 'A senha é obrigatória.',
		};
	}

	if (!PASSWORD_REGEX.test(password)) {
		return {
			isValid: false,
			message: 'A senha deve ter no mínimo 8 caracteres, contendo pelo menos 1 letra maiúscula, 1 letra minúscula, 1 número e 1 caractere especial.',
		};
	}

	return { isValid: true };
}
