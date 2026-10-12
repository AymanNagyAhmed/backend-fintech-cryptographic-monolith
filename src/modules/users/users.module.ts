import { Module } from '@nestjs/common';
import { PasswordHasher } from './password-hasher.js';
import { UsersService } from './users.service.js';

// PrismaService comes from the global DatabaseModule
@Module({
  providers: [UsersService, PasswordHasher],
  exports: [UsersService],
})
export class UsersModule {}
