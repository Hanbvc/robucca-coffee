import { Module } from '@nestjs/common';
import { DevicesModule } from '../devices/devices.module';
import { MenuAdminService } from './menu-admin.service';
import { OfficeEvents } from './office.common';
import { OfficeController } from './office.controller';
import { OrgAdminService } from './org-admin.service';
import { PosShiftController } from './pos-shift.controller';
import { ReportService } from './report.service';
import { SalesService } from './sales.service';
import { StockAdminService } from './stock-admin.service';

/** API kantor (/office/*) + pemulihan shift terbuka untuk perangkat POS (/pos/shift/open). */
@Module({
  imports: [DevicesModule],
  controllers: [OfficeController, PosShiftController],
  providers: [OfficeEvents, ReportService, SalesService, MenuAdminService, StockAdminService, OrgAdminService],
})
export class OfficeModule {}
