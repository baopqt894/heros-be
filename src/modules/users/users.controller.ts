import { Body, Controller, Get, Patch, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

@ApiTags('users')
@ApiBearerAuth('bearer-token')
@Controller('me')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @ApiOperation({
    summary:
      'Account profile including its preassigned active physical device, or device: null. No Bluetooth pairing required.',
  })
  async getMe(@CurrentUser() user: AuthenticatedUser) {
    return {
      success: true,
      data: await this.usersService.getProfile(user.sub),
    };
  }

  @Patch()
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateUserDto
  ) {
    return {
      success: true,
      data: await this.usersService.updateMe(user.sub, dto),
    };
  }

  @Put('location')
  async updateLocation(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateLocationDto
  ) {
    return {
      success: true,
      data: await this.usersService.updateLocation(user.sub, dto),
    };
  }
}
