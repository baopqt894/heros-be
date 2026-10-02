import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { HardwareDevicesService } from './hardware-devices.service';

@Injectable()
export class HardwareAuthGuard implements CanActivate {
  constructor(private readonly hardware: HardwareDevicesService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    request.hardware = await this.hardware.authenticate(
      request.headers['x-heros-hardware-id'],
      request.headers['x-heros-device-token']
    );
    return true;
  }
}
