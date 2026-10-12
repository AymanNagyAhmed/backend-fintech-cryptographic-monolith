import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'is_public';

/** Opts a route or controller out of the global JWT guard; every other route needs a Bearer token. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
