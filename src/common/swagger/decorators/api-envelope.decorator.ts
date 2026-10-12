import { applyDecorators } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiResponse,
  getSchemaPath,
  type SchemaObject,
} from '@nestjs/swagger';
import { ApiFailureDto, ApiSuccessDto } from '../dto/api-envelope.dto.js';

/** Documents a success response as the envelope with the given `data` schema or DTO `$ref`. */
export function ApiOkEnvelope(
  data: SchemaObject | { $ref: string },
  status = 200,
  description?: string,
) {
  return applyDecorators(
    ApiExtraModels(ApiSuccessDto),
    ApiResponse({
      status,
      description,
      schema: {
        allOf: [
          { $ref: getSchemaPath(ApiSuccessDto) },
          { properties: { data } },
        ],
      },
    }),
  );
}

export function ApiFailureResponse(status: number, description: string) {
  return applyDecorators(
    ApiExtraModels(ApiFailureDto),
    ApiResponse({ status, description, type: ApiFailureDto }),
  );
}
