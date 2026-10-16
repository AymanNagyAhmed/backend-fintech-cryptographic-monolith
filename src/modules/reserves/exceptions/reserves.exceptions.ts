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

export const reservesSnapshotNotFound = (currency: string) =>
  new DomainException(
    'RESERVES_SNAPSHOT_NOT_FOUND',
    `No published ${currency} reserves snapshot.`,
    HttpStatus.NOT_FOUND,
  );

export const reservesLeafNotFound = () =>
  new DomainException(
    'RESERVES_LEAF_NOT_FOUND',
    'No leaf for this user in the latest reserves snapshot (zero balance or not included).',
    HttpStatus.NOT_FOUND,
  );

export const reservesUnderCollateralized = (
  currency: string,
  liabilities: string,
  reserves: string,
) =>
  new DomainException(
    'RESERVES_UNDER_COLLATERALIZED',
    `${currency} reserves ${reserves} are below liabilities ${liabilities}.`,
    HttpStatus.UNPROCESSABLE_ENTITY,
  );
