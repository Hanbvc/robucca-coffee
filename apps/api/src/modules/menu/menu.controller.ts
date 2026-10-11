import { Controller, Get, Param } from '@nestjs/common';
import { BranchCodeParams } from '../branches/branch-code.dto';
import { MenuService } from './menu.service';

@Controller('branches/:code/menu')
export class MenuController {
  constructor(private readonly menu: MenuService) {}

  /** Menu pelanggan per cabang (PWA, menu QR, POS saat awal sinkron). */
  @Get()
  get(@Param() { code }: BranchCodeParams) {
    return this.menu.forBranch(code);
  }
}
