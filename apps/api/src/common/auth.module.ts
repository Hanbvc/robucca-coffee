import { Global, Module } from '@nestjs/common';
import { AuthService, DeviceGuard, StaffGuard } from './auth';

@Global()
@Module({
  providers: [AuthService, DeviceGuard, StaffGuard],
  exports: [AuthService, DeviceGuard, StaffGuard],
})
export class AuthModule {}
