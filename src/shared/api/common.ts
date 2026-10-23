import { z } from 'zod';
import { ErrorCode } from '../enums';
import { MicrosString } from '../money';

export { MicrosString };

/** Lowercase 0x address. */
export const Address = z.string().regex(/^0x[0-9a-f]{40}$/, 'expected a lowercase 0x address');
export const Hex = z.string().regex(/^0x[0-9a-fA-F]*$/);
export const TxHash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
export const Bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
/** ISO-8601 timestamp string. */
export const IsoTime = z.string().datetime({ offset: true });
/** USD card amounts: integer cents as strings. */
export const CentsString = z.string().regex(/^\d{1,18}$/);
export const Uuid = z.string().uuid();

/** Dashboard/app error body. */
export const ApiError = z.object({
  error: z.object({
    code: z.enum(ErrorCode),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

/** OpenAI-compatible error body. */
export const OpenAIError = z.object({
  error: z.object({ message: z.string(), type: z.string(), code: z.string().nullable() }),
});
export type OpenAIError = z.infer<typeof OpenAIError>;

export const PageQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type PageQuery = z.infer<typeof PageQuery>;

export const Paginated = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });

/** Contract call descriptor returned by *-call routes. */
export const ContractCall = z.object({
  to: Address,
  functionName: z.string().optional(),
  args: z.array(z.unknown()),
  value: z.string().optional(),
});
export type ContractCall = z.infer<typeof ContractCall>;

export const IdParam = z.object({ id: z.string() });
export const JobIdParam = z.object({ jobId: z.string().uuid() });

export const NoContent = z.void();
