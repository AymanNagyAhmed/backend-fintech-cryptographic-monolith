import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../../../common/exceptions/domain.exception.js';

export const reservesSnapshotExists = (currency: string, date: string) =>
  new DomainException(
    'RESERVES_SNAPSHOT_EXISTS',
    `A ${currency} reserves snapshot for ${date} is already published.`,
    HttpStatus.CONFLICT,
  );

export const reservesNoLiabilities = (currency: string) =>
  new DomainException(
    'RESERVES_NO_LIABILITIES',
    `No client holds a positive ${currency} balance; there is nothing to commit to.`,
    HttpStatus.UNPROCESSABLE_ENTITY,
  );
